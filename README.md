# mqtt2homekit
> Control HomeKit-enabled devices with the ubiquity of MQTT

[![NPM Version][npm-image]][npm-url]
[![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE.md)

mqtt2homekit is a Node.js application that links HomeKit-enabled devices to an MQTT broker. It is designed to be used to integrate these devices into a home automation system in the style of [mqtt-smarthome](http://www.github.com/mqtt-smarthome/mqtt-smarthome/).

## But wait!

"[homekit2mqtt](http://www.github.com/hobbyquaker/homekit2mqtt) already exists! How is this different?" I hear you ask.

The answer is that this project is more or less the opposite of `homekit2matt` -- with `homekitk2mqtt` you use HomeKit tech (Siri, apps, etc) to control non-HomeKit-enabled devices using MQTT. With `mqtt2homekit` you use MQTT to control devices that are HomeKit-enabled but that don't provide any other API that meets your needs.  For example, the Ecobee3 thermostat only provides an API that goes through their cloud server, whereas with this tool you can control your thermostat over your local network with no cloud service involved.

## Getting Started

mqtt2homekit is distributed through NPM:

```sh
npm install -g mqtt2homekit

# or, if you prefer:
yarn global add mqtt2homekit
```

Running it is likewise easy:

```sh
mqtt2homekit -m mapping.json                      # if your MQTT broker is running on localhost
mqtt2homekit -m mapping.json -b mqtt://<hostname> # if your broker is running elsewhere
mqtt2homekit --help                               # to see the full usage documentation
```

`mqtt2homekit` supports as many mapping files as you choose to provide, so you only need one running instance for all of your HomeKit devices:

```sh
mqtt2homekit -m map1.json -m map2.json # ... etc
```

## Pairing

Currently pairing with the HomeKit device is left up to [hap-client-tool](http://www.github.com/forty2/hap-client-tool).  Please specify the client name `mqtt2homekit` when pairing:

```sh
$ yarn add global hap-client-tool
$ hap-client-tool -c mqtt2homekit -d <ip> -p <port> pair
```

## Topics and Payloads

Because `mqtt2homekit` can connect to such a wide variety of different equipment, it requires some help from you in the form of a mapping file to figure out how to map devices to topics and payloads.

From this, a set of topics to publish and subscribe will be caluclated:

Topic Template | Description
---------------|------------
`<prefix>/status/<topicName>` | Readable properties will automatically publish their values here
`<prefix>/get/<topicName>` | Readable properties will subscribe to these topics to listen for requests to refresh.
`<prefix>/set/<topicName>` | Writeable properties will subscribe to these topics to listen for changes

In addition, any properties that support update notification events will automatically listen for those events and publish the new values.

## Creating your own mapping

At the top level, the mapping file contains device info and a list of topics:

```json
{
  "host": "aaa.bbb.ccc.ddd",
  "port": 12345,
  "topics": [
      // ...
  ]
}
```

Each topic consists of an MQTT topic prefix, a HomeKit accessory ID, and a list of values: 
```json
{
  "prefix": "sensors:bedroom",
  "aid": 3,
  "values": [
      // ...
  ]
}
```

Each value consists of an MQTT topic name, a HomeKit instance ID, and an optional valueMap that maps from HomeKit values to MQTT payloads.
```json
{
  "iid": 3089,
  "topicName": "isBatteryLow",
  "valueMap": {
    "0": "false",
    "1": "true
  }
}
```

Here's a complete example:
```json
{
    "host": "aaa.bbb.ccc.ddd",
    "port": 12345,
    "topics": [
        {
            "prefix": "ecobee:home",
            "aid": 1,
            "values": [
                {
                    "iid": 17,
                    "topicName": "currentState"
                },
                {
                    "iid": 18,
                    "topicName": "targetState"
                },
                {
                    "iid": 19,
                    "topicName": "currentTemp"
                },
                {
                    "iid": 20,
                    "topicName": "targetTemp"
                }
            ]
        },
        {
            "prefix": "sensors:hallway",
            "aid": 1,
            "values": [
                {
                    "iid": 66,
                    "topicName": "isMotionDetected"
                },
                {
                    "iid": 65,
                    "topicName": "isOccupied",
                    "valueMap": {
                        "0": "false",
                        "1": "true"
                    }
                }
            ]
        },
        {
            "prefix": "sensors:livingroom",
            "aid": 2,
            "values": [
                {
                    "iid": 2064,
                    "topicName": "currentTemp"
                },
                {
                    "iid": 2065,
                    "topicName": "isBatteryLow",
                    "valueMap": {
                        "0": "false",
                        "1": "true"
                    }
                },
                {
                    "iid": 2060,
                    "topicName": "isMotionDetected"
                }
            ]
        },
        {
            "prefix": "sensors:bedroom",
            "aid": 3,
            "values": [
                {
                    "iid": 3088,
                    "topicName": "currentTemp"
                },
                {
                    "iid": 3089,
                    "topicName": "isBatteryLow",
                    "valueMap": {
                        "0": "false",
                        "1": "true"
                    }
                },
                {
                    "iid": 3084,
                    "topicName": "isMotionDetected"
                }
            ]
        }
    ]
}
```

In addition to pairing, `hap-client-tool` is very useful for developing a new mapping file.  Its `dump` command will dump a list of all of the supported accessories, services, and characteristics provided by your device.

```sh
# after pairing
$ hap-client-tool -c mqtt2homekit -d <ip> -p <port> dump
```

## Contributing

Contributions are of course always welcome.  If you find problems, please report them in the [Issue Tracker](http://www.github.com/forty2/mqtt2homekit/issues/).  If you've made an improvement or you'd like to contribute an example mapping file or metadata about a new device type's custom properties, open a [pull request](http://www.github.com/forty2/mqtt2homekit/pulls).

Getting set up for development is very easy:
```sh
git clone <your fork>
cd mqtt2homekit
yarn
```

And the development workflow is likewise straightforward:
```sh
# make a change to the src/ file, then...
yarn build
node dist/index.js

# or if you want to clean up all the leftover build products:
yarn run clean
```

## Release History

* 1.0.0
    * The first release.

## Meta

Zach Bean – zb@forty2.com

Distributed under the MIT license. See [LICENSE](LICENSE.md) for more detail.

[npm-image]: https://img.shields.io/npm/v/haiku2mqtt.svg?style=flat
[npm-url]: https://npmjs.org/package/haiku2mqtt
