import 'source-map-support/register';

import util from 'util';
import path from 'path';

import glob from 'glob';
import merge from 'lodash.merge';
import { Observable } from 'rxjs';
import MQTT from 'mqtt';
import to from 'to-case';
import TopicMatcher from 'mqtt-topics';

import HapClient from 'hap-client';

import args from './args';

const STATUS_OPTS = { qos: 2, retain: true };

const meta =
    glob.sync(__dirname + '/metadata/**/*.json', { ignore: '**/default.json' })
        .map(x => path.relative(__dirname, x))
        .reduce(
            (acc, x) => merge(acc, require('./' + x)),
            require('./metadata/default.json')
        );

const Services = processList(meta['Services']);
const Characteristics = processList(meta['Characteristics']);

const clients = { };

[ args.mapping ]
    ::flatten()
    .map(
        x =>
            processMapping(x)
                .do({
                    error(e) { console.error(e); }
                })
                .catch(
                    (err, caught) => caught
                )
    )
    ::toArray()
    .forEach(
        arr => {
            Observable
                .merge(...arr)
                .subscribe(
                    x => { },
                    e => console.error(e)
                )
        }
    )

function processMapping(file) {
    if (!path.isAbsolute(file)) {
        file = path.relative(process.cwd(), file);
    }
    const mapping = require(file);

    const mqtt = { };

    mapping
        .topics
        .forEach(
            ({ prefix }) => {
                mqtt[prefix] =
                    MQTT
                        .connect(
                            args.broker, 
                            {
                                will: {
                                    topic: `${prefix}/connected`,
                                    payload: '0',
                                    ...STATUS_OPTS
                                }
                            }
                        )
                        .publish(
                            `${prefix}/connected`,
                            '2',
                            STATUS_OPTS
                        );
            }
        );

    const client =
        clients[file] =
            new HapClient('mqtt2homekit', mapping.host, mapping.port);

    return client
        .listAccessories()
        .take(1)
        .flatMap(
            accessories => {
                /*
                 * for topics that support event notifications, register
                 * for the events
                 */
                const event =
                    client
                        .setCharacteristics(
                            ...getTopics('cnotify', mapping, accessories)
                                .map(({ aid, iid }) => ({ aid, iid, ev: true }))
                        )

                /*
                 * for topics that are readable:
                 *   - listen to requests to force an update
                 *   - start with a forced update to "prime" the system
                 */
                const read =
                    Observable
                        .from(
                            getTopics('read', mapping, accessories)
                        )
                        .reduce(
                            (acc, { aid, iid, prefix, topicName }) => {
                                acc.prime = acc.prime.concat(aid, iid);
                                acc.listeners.push(
                                    getMessages(prefix, `get/${topicName}`)
                                );
                                return acc;
                            },
                            { prime: [], listeners: [] }
                        )
                        .mergeMap(
                            ({ prime, listeners }) =>
                                client
                                    .getCharacteristics(...prime)
                                    .concat(
                                        Observable
                                            .merge(
                                                ...listeners
                                            )
                                    )
                        )

                /*
                 * for topics that are writeable, start listening for
                 * change requests
                 */
                const write =
                    Observable
                        .from(
                            getTopics('write', mapping, accessories)
                        )
                        .mergeMap(
                            ({ aid, iid, prefix, topicName }) =>
                                getMessages(prefix, `set/${topicName}`)
                                    .flatMap(
                                        ({ message }) => {
                                            const value = mqttToHomekit(aid, iid, message);
                                            
                                            return value !== null
                                                ? client
                                                    .setCharacteristics(
                                                        { aid, iid, value }
                                                    )
                                                : Observable.empty();
                                        }
                                    )
                        )

                return Observable
                    .merge(
                        event,
                        read,
                        write
                    )
                    .ignoreElements()
                    .merge(
                        client.messages
                    )
                    .do(handleResponse(client))

                function mqttToHomekit(aid, iid, payload) {
                    const { Format, Constraints, ...rest } =
                        getTopicsByIds(aid, iid, mapping, accessories)[0];

                    // TODO: deal with:
                    //   - bitfields

                    switch (Format) {
                        case "bool":
                            // convert the payload to an actual bool
                            payload = (
                                payload === (rest.trueValue || 'true')
                            );
                            break;

                        case "float":
                        case "int32":
                        case "uint32":
                        case "uint8": {
                            // first, convert to a number
                            if (!isNaN(payload / 1)) {
                                payload /= 1;
                            }

                            // there are either ValidValues, MaximumValue/MinimumValue, or nothing.
                            if (Constraints.ValidValues) {
                                let valueMap =
                                    rest.valueMap
                                        || Object
                                            .keys(Constraints.ValidValues)
                                            .reduce(
                                                (acc, x) => {
                                                    acc[x] = to.camel(Constraints.ValidValues[x])
                                                    return acc;
                                                }, { })

                                const swapped =
                                    Object
                                        .keys(valueMap)
                                        .reduce(
                                            (acc, x) => {
                                                acc[valueMap[x]] = x
                                                return acc;
                                            }, { }
                                        )

                                payload =
                                    swapped.hasOwnProperty(payload)
                                        ? swapped[payload]
                                        : null;
                            }
                            else {
                                if (Constraints.MaximumValue &&
                                        payload > Constraints.MaximumValue)
                                {
                                    payload = null;
                                }
                                if (Constraints.MinimumValue &&
                                        payload < Constraints.MinimumValue)
                                {
                                    payload = null;
                                }
                            }
                            break;
                        }

                        case "string":
                            // no changes needed
                            break;

                        case "tlv8":
                        default:
                            // these aren't supported (yet?)
                            payload = null;
                            break;
                    }

                    return payload;
                }

                function homekitToMqtt(aid, iid, value) {
                    const { Format, Constraints, ...rest } =
                        getTopicsByIds(aid, iid, mapping, accessories)[0];

                    // TODO: deal with:
                    //   - bitfields

                    switch (Format) {
                        case "float":
                        case "int32":
                        case "uint32":
                        case "uint8": {
                            // since these numbers came from HomeKit, we can assume they're valid
                            // so we only need to do ValidValues mapping
                            if (Constraints.ValidValues) {
                                let valueMap =
                                    rest.valueMap
                                        || Object
                                            .keys(Constraints.ValidValues)
                                            .reduce(
                                                (acc, x) => {
                                                    acc[x] = to.camel(Constraints.ValidValues[x])
                                                    return acc;
                                                }, { })

                                value =
                                    valueMap.hasOwnProperty(value)
                                        ? valueMap[value]
                                        : null;
                            }

                            break;
                        }

                        case "bool":
                        case "string":
                            // no changes needed
                            break;

                        case "tlv8":
                        default:
                            // these aren't supported (yet?)
                            value = null;
                            break;
                    }

                    return value != null ? value.toString() : value;
                }

                function getMessages(prefix, suffix) {
                    return new Observable(
                        subscriber => {
                            const topicFilter = `${prefix}/${suffix}`;
                            const topics = [ topicFilter ]
                            mqtt[prefix].subscribe(topics);
                            mqtt[prefix].on('message', (topic, msg) => {
                                if (TopicMatcher.match(topicFilter, topic)) {
                                    subscriber.next({
                                        topic,
                                        message: msg.toString()
                                    })
                                }
                            });

                            return () => {
                                mqtt[prefix].unsubscribe(topics);
                            }
                        }
                    );
                }

                function handleResponse(client) {
                    return function({ status, body }) {
                        if (status < 200 || status >= 399) return;

                        const { characteristics = [] } = (body || {});

                        // look up topic to publish status to, then publish it.
                        characteristics
                            .forEach(
                                ({ aid, iid, value }) => {
                                    const {
                                        prefix,
                                        topicName
                                    } = getTopicsByIds(aid, iid, mapping, accessories)[0];

                                    value = homekitToMqtt(aid, iid, value);

                                    if (value !== null) {
                                        mqtt[prefix]
                                            .publish(
                                                `${prefix}/status/${topicName}`,
                                                value,
                                                STATUS_OPTS
                                            );
                                    }
                                }
                            )
                    }
                }
            }
        )
}

// TODO: find a more efficient way of doing this
function getTopicsByIds(aid, iid, mapping, accessories) {
    return mapping
        .topics
        .filter(({ aid: targetAid }) => aid === targetAid)
        ::flatMap(
            ({ aid, prefix, values }) =>
                values
                    .filter(({ iid: targetIid }) => iid === targetIid)
                    .map(
                        ({ iid, ...rest }) => ({
                            aid,
                            prefix,
                            ...getCharacteristicByIds(aid, iid, accessories),
                            ...rest
                        })
                    )
        )
}

// TODO: find a more efficient way of doing this
function getTopics(permission, mapping, accessories) {
    return mapping
        .topics
        ::flatMap(
            ({ aid, prefix, values }) =>
                values
                    .map(
                        ({ iid, ...rest }) => ({
                            aid,
                            prefix,
                            ...getCharacteristicByIds(aid, iid, accessories),
                            ...rest
                        })
                    )
                    .filter(
                        ({ Properties }) => Properties.includes(permission)
                    )
        )
}

function* getCharacteristicsByAid(aid, accessories) {
    yield* accessories
        .filter(({ aid: targetAid }) => targetAid === aid)
        ::flatMap(
            ({ services }) => services
        )
        ::flatMap(
            ({ characteristics }) => characteristics
        )
}

function getCharacteristicByIds(aid, iid, { accessories }) {
    const val = 
        getCharacteristicsByAid(aid, accessories)
            ::filter(({ iid: targetIid }) => targetIid === iid)
            .next()
            .value;

    return {
        ...val,
        ...Characteristics[val.type]
    }
}

function* filter(predicate) {
    for (let x of this) {
        if (predicate(x)) {
            yield x;
        }
    }
}

function flatten() {
    return [].concat.apply([], this);
}

function flatMap(projection) {
    return this.map(projection)::flatten();
}

function get(name) {
    return this ? this[name] : undefined
}

function toArray() {
    return [
        this.reduce(
            (acc, x) => acc.concat(x),
            []
        )
    ]
}

function processList(list) {
    return list
        .reduce(
            (acc, { UUID, ...rest }) => {
                acc[UUID] = rest;

                let m;
                if (m = /0*([0-9A-F]+)-0000-1000-8000-0026BB765291/.exec(UUID)) {
                    acc[m[1]] = rest;
                }

                return acc;
            }, { }
        )
}
