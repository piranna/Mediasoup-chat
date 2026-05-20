# Mediasoup-chat

PoC of using [Mediasoup](https://mediasoup.org/) DataChannels as alternative to
WebSockets

This repo contains a proof of concept about how to use Mediasoup SCTP
connections (DataChannels) as alternative to WebSockets. This is done mostly for
educational purposses to understand how to use Mediasoup
[DataProducer](https://mediasoup.org/documentation/v3/mediasoup/api/#DataProducer)s
and
[DataConsumer](https://mediasoup.org/documentation/v3/mediasoup/api/#DataConsumer)s,
and as a study to identify in what use cases it can makes sense to use them.

## Options

This PoC makes use of [fastify-cli](https://github.com/fastify/fastify-cli). To
use any of the custom options, just add them after the `--` terminator.

- `announcedIp`: IP address to announce to the network. Only needed if setting
  the fastify CLI `--address` option or the `FASTIFY_ADDRESS` environment
  variable to `0.0.0.0`.

## How it was done

### Using Mediasoup Router

Initial implementation was a simple `echo` server, that returns everything that
you write to it, without exchange of messages between clients. For bootstrap
signaling, it uses a [fastify](https://github.com/fastify/fastify) web server
providing a REST API to

- get the router RTP capabilities (although we only use SCTP connections, they
  are needed for initialization of the clients
  [Mediasoup client `Device`](https://mediasoup.org/documentation/v3/mediasoup-client/api/#Device)
  instance, not sure if due to a limitation its API or because they are in fact
  being used under the hood)
- create the new WebRTC transports server-side
- connect them to the clients WebRTC endpoints
- and register them as data producers and consumers

the example shows how to work with DataChannels, doing an echo by just reurning
everything that it receives. Yes, next step would be send the data to other
clients, here we have two options, doing it the same way using Router, that's
the same we it's currently done and how we do the routing of the streams, but
requires a signaling channel (both external or by using another DataChannel), or
by processing the DataChannel messages, that's mostly how it's being done with
WebSockets communications

both ways are ok, by having a DataChannel per message type it's Mediasoup doing
the multiplexing, by having a single DataChannel we need to do the multiplexing
by hand. First is cleaner but more obscure and maybe more memory consuming,
second one is clearer and intuitive but less performant

### Processing messages server-side

Next iteration was to interconnect clients between them, consuming the data from
the other ones (similar to publish/subscribe schemes), allowing to exchange
messages between clients. This has shown it's needed a side channel to notify
from the server to the clients that a new one has connected so they can start
consuming its data, between other updates. As alternatives for this side
channel, it has been considered to use Server Send Events, WebSockets,
long-polling, or an additional DataChannel connections

Both this iterations

SSE DataChannel

single DataChannel, messages processed server-side (like webSockets)

## Conclusions

This PoC has shown it's possible to use Mediasoup SCTP connections, and in
general any server-based DataChannel connection, as an alternative to WebSockets
or any other bidirectional channels, but for most use cases probably it's not
the best option since it requires an external signaling channel, increasing the
complexity of the needed architecture and its implementation.

Due to that, in my opinion the only valid use cases are that we are already
making use Mediasoup functionality (like audio or video streaming) and we want
to have an homogeneous architecture with them also for raw data transfers
(specially if we only need to route the SCTP connections and we don't need to
process the messages server-side), or for direct server-to-server connections
between Mediasoup instances located in different processes and/or machines and
without an hierarchy between them that we know in advance will not change during
process lifecycle nor needs to be created dinamically.
