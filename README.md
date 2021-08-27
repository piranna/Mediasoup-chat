# Mediasoup-chat

PoC of using Mediasoup DataChannels as alternative to WebSockets

## Options

This PoC makes use of [fastify-cli](https://github.com/fastify/fastify-cli). To
use any of the custom options, just add them after the `--` terminator.

- `announcedIp`: IP address to announce to the network. Only needed if setting
  the fastify CLI `--address` option or the `FASTIFY_ADDRESS` environment
  variable to `0.0.0.0`.
