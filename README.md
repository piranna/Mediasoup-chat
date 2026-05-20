# Mediasoup-chat

PoC of using [Mediasoup](https://mediasoup.org/) DataChannels as alternative to
WebSockets

This repo contains a proof of concept about how to use Mediasoup SCTP
connections (DataChannels) as alternative to WebSockets. This is done mostly for
educational purposes to understand how to use Mediasoup
[DataProducer](https://mediasoup.org/documentation/v3/mediasoup/api/#DataProducer)s
and
[DataConsumer](https://mediasoup.org/documentation/v3/mediasoup/api/#DataConsumer)s,
and as a study to identify in what use cases it can makes sense to use them.

## Project Stack

- **Server**: Node.js with Fastify web framework and mediasoup 3.19.x
- **Client**: Vanilla JavaScript with mediasoup-client library (loaded from CDN)
- **Communication Protocol**: SCTP (over WebRTC DataChannels)
- **Signaling**: REST API for transport negotiation and producer/consumer
  coordination
- **Deployment**: Static file serving + Server-sent processes via fastify-cli

## Quick Start

```bash
npm install
npm run dev        # Runs development server with logging
# or
npm start          # Production server start
```

Access the chat at `http://localhost:3000` (or the configured address)

## Options

This PoC makes use of [fastify-cli](https://github.com/fastify/fastify-cli). To
use any of the custom options, just add them after the `--` terminator.

- `announcedIp`: IP address to announce to the network. Only needed if setting
  the fastify CLI `--address` option or the `FASTIFY_ADDRESS` environment
  variable to `0.0.0.0`. This is essential for WebRTC connections to work
  correctly when the server is behind NAT or accessed from remote clients.

## How it was done

### Architecture Deep Dive

The PoC implements a simplified chat application using Mediasoup's DataChannel
infrastructure. Unlike WebSockets (which open a single TCP connection), this
approach uses WebRTC's SCTP transport layer, with Mediasoup managing the complex
WebRTC negotiation, encryption (DTLS), and connection establishment.

#### Connection Setup Sequence

1. **Client Initialization** (`GET /routerRtpCapabilities`)
   - Client fetches router capabilities required to initialize the
     mediasoup-client Device
   - This happens once per page load and primes the Device to negotiate media
     parameters

2. **Transport Creation** (`POST /`)
   - Client requests a new WebRtcTransport from the server
   - Server creates transport with SCTP enabled and returns:
     - Transport ID (for future references)
     - ICE candidates (potential network paths to reach the server)
     - ICE parameters and credentials (for ICE connectivity checks)
     - DTLS parameters (server's certificate fingerprint for encryption)
     - SCTP parameters (stream configuration for the data channel)

3. **DTLS Handshake** (`POST /:webRtcTransportId/connect`)
   - Client sends its DTLS fingerprint to the server (completes the handshake)
   - Server establishes the encrypted connection
   - At this point, the WebRTC connection is ready for media

#### Publishing Messages

1. **DataProducer Creation** (`POST /:webRtcTransportId/produceData`)
   - Client creates a DataProducer on the SendTransport
   - Client sends producer parameters (label, protocol, SCTP stream settings) to
     server
   - Server creates a DataProducer on the WebRtcTransport and immediately:
     - Creates a DirectTransport (in-memory transport on the same server
       process)
     - Consumes the DataProducer via the DirectTransport
     - Stores the DirectTransport consumer indexed by the DataProducer ID
   - Returns the DataProducer ID to the client
   - When client sends a message via `dataProducer.send(data)`, it flows
     directly through the WebRTC connection to the server's DirectTransport
     consumer

#### Subscribing to Messages

1. **DataConsumer Creation** (`POST /:webRtcTransportId/consumeData`)
   - Client specifies which DataProducer ID it wants to consume (subscribe to)
   - Server looks up the DirectTransport consumer for that producer
   - Creates a new DirectTransport with a DataProducer
   - Connects the incoming producer's consumer to this new producer's stream:

     ```javascript
     directTransportDataConsumer.on("message", onMessage);
     // where onMessage = directTransportDataProducer.send
     ```

   - Returns consumer parameters to the client
   - Client creates a DataConsumer with these parameters
   - Messages now flow: **Server's DirectTransport → Client's DataConsumer →
     UI**

#### Data Flow Summary

```
Client A                       Server                        Client B
  │                              │                              │
  ├─ POST / (create transport)─→ │                              │
  │ ← (transport params) ────────┤                              │
  │                              │                              │
  ├─ POST /xxx/connect ────────→ │                              │
  │ (DTLS handshake complete)    │                              │
  │                              │                              │
  ├─ POST /xxx/produceData ────→ │                              │
  │ (sends params) ◄─ Direct     │                              │
  │                Transport     │                              │
  │ ◄─ (producer ID) ────────────┤                              │
  │                              │                              │
  │                              │ ← POST / (create transport)─ │
  │                              │ ← (transport params) ─────── │
  │                              │                              │
  │                              │ ← POST /yyy/connect ──────── │
  │                              │ (DTLS handshake)             │
  │                              │                              │
  │                              │ ← POST /yyy/consumeData───── │
  │                              │   (subscribes to producer)   │
  │                              │ ─→ (consumer params) ──────  │
  │                              │                              │
send("Hello")─┐                  │                              │
              ├─→ WebRTC data──→ DirectTransport Consumer       │
              │                  │      ↓                       │
              │                  │ DirectTransport Producer     │
              │                  │      │                       │
              │                  └─ WebRTC data→ Receive ───────┘
              │                                              │
              │                                    onmessage("Hello")
```

### Using Mediasoup Router

Initial implementation was a simple `echo` server, that returns everything that
you write to it, without exchange of messages between clients. For bootstrap
signaling, it uses a [fastify](https://github.com/fastify/fastify) web server
providing a REST API to:

- **`GET /routerRtpCapabilities`**: Retrieve the router RTP capabilities
  (required for initialization of the clients
  [Mediasoup client `Device`](https://mediasoup.org/documentation/v3/mediasoup-client/api/#Device)
  instance, needed even for SCTP-only connections as per mediasoup-client API
  design)
- **`POST /`**: Create new WebRtcTransport server-side with SCTP enabled,
  returning transport parameters (ICE candidates, DTLS parameters, SCTP
  parameters) for the client to establish the connection
- **`POST /:webRtcTransportId/connect`**: Complete the DTLS handshake by sending
  client DTLS fingerprints to establish the secure connection
- **`POST /:webRtcTransportId/produceData`**: Create a DataProducer on a
  WebRtcTransport (client publishing messages) and immediately create a
  corresponding DirectTransport consumer on the server to relay the data
- **`POST /:webRtcTransportId/consumeData`**: Create a DataConsumer on a
  WebRtcTransport (client subscribing to messages) by consuming data from the
  server's DirectTransport producer

### Processing messages server-side

Next iteration was to interconnect clients between them, consuming the data from
the other ones (similar to publish/subscribe schemes), allowing to exchange
messages between clients. This has shown it's needed a side channel to notify
from the server to the clients that a new one has connected so they can start
consuming its data, between other updates. As alternatives for this side
channel, it has been considered to use Server Send Events, WebSockets,
long-polling, or an additional DataChannel connections.

#### Client-Side Implementation

Each client:

1. Loads the Router RTP capabilities and initializes a mediasoup-client `Device`
2. Creates a **SendTransport** (WebRtcTransport) for publishing messages
   - Produces a DataProducer on this transport via the `/produceData` endpoint
   - Messages sent via `dataProducer.send(message)` flow through the WebRTC
     connection
3. Creates a **RecvTransport** (separate WebRtcTransport) for receiving messages
   - Consumes a DataConsumer from the server via the `/consumeData` endpoint
4. Listens to `dataConsumer.on("message", ...)` events for incoming messages

#### Server-Side Message Relay

The server uses a **DirectTransport** relay pattern:

1. When a client produces data (sends a message), the server creates a
   DirectTransport and immediately consumes the incoming DataProducer
2. This DirectTransport Consumer is stored in
   `directTransportDataConsumers[dataProducerId]`
3. When another client wants to consume messages from the first client, the
   server:
   - Creates another DirectTransport with a DataProducer
   - Pipes the first client's consumed messages to this new DataProducer
   - Returns the Consumer parameters to the client via `/consumeData`
4. Messages flow as: **Client A → WebRtcTransport DataProducer → DirectTransport
   Consumer → DirectTransport Producer → Client B's WebRtcTransport
   DataConsumer**

This DirectTransport relay design allows the server to:

- Inspect and forward data without requiring heavy message processing logic
- Maintain separation between clients' connections
- Scale message distribution to multiple subscribers without per-client routing
  logic

Both this and subsequent iterations demonstrated that while this approach works,
it requires:

- An external signaling channel (REST API in this case) to coordinate client
  connections and subscriptions
- Separate transports for sending and receiving (as per mediasoup DataChannel
  architecture)
- Server-side state management for all active producers and consumers

## Conclusions

### Architecture Analysis

This PoC has demonstrated that it's technically feasible to use Mediasoup SCTP
connections (DataChannels) as a complete alternative to WebSockets or similar
bidirectional channels. However, the implementation revealed significant
architectural complexity:

**Key Trade-offs:**

1. **Increased Complexity**: Requires a separate signaling channel (REST API)
   for session management beyond the DataChannels themselves, unlike WebSockets
   which combine both signaling and data in one connection

2. **Double Transport Overhead**: Client-side requires both SendTransport and
   RecvTransport for basic bidirectional communication, adding memory and
   connection establishment overhead compared to a single persistent WebSocket

3. **Server-Side State Management**: Maintaining DirectTransports for each
   producer-consumer pair adds complexity and memory footprint as the number of
   connected clients grows

4. **Message Routing**: The DirectTransport relay pattern works but requires
   explicit server logic to match producers with consumers and forward messages,
   removing the implicit broadcast semantics of WebSocket-based approaches

**When Mediasoup DataChannels Make Sense:**

The only practically valid use cases are:

- **Homogeneous Architecture**: When the application already uses Mediasoup for
  audio/video streaming and wants to integrate raw data transfers (messages,
  2-stages signaling, control data) within the same unified infrastructure. This
  simplifies monitoring, resource management, and operations since all media
  types flow through the same Mediasoup router

- **Server-to-Server Communication**: Direct connections between Mediasoup
  instances running in different processes and/or machines without a pre-defined
  hierarchy. In this scenario:
  - No external signaling needed (can use direct Mediasoup Router connections)
  - Network topology can be dynamic
  - Avoids introducing additional communication frameworks for inter-service
    messaging

**Comparison with Alternatives:**

For typical web applications needing real-time bidirectional communication,
WebSockets remain superior due to:

- Single connection for both signaling and data
- Simpler client and server implementations
- Lower overhead and better resource utilization
- Native support across all modern browsers and frameworks
- Extensive tooling and libraries (Socket.io, etc.)

Using Mediasoup DataChannels for chat or general messaging is an engineering
anti-pattern that trades simplicity and performance for architectural
consistency that doesn't justify the added complexity for most projects. But it
can make sense for niche use cases where tight integration with media streams is
required, like chats associated with a live media streaming (e.g., live sports
commentary, classes, live events, cam streamings) without needing an additional
chat server and keeping sync of their identifiers, or for server-to-server
communication within a Mediasoup-based architecture.

## Technical Insights for Implementation

### Design Pattern: DirectTransport Relay

The core innovation in this PoC is the **DirectTransport relay pattern**. Rather
than implementing application-level message routing logic, it leverages
Mediasoup's built-in transport infrastructure:

- **In-Memory Efficiency**: DirectTransports are same-process, reducing latency
  compared to network hops
- **Automatic Lifecycle**: When a WebRtcTransport closes, its associated
  DirectTransport consumers can be cleaned up via the `observer.on("close")`
  events
- **Elegant Symmetry**: The pattern mirrors how Mediasoup handles audio/video,
  making the codebase more predictable for teams familiar with Mediasoup

### Signaling Channel Necessity

WebRTC fundamentally requires out-of-band signaling to establish connections.
This PoC uses REST for simplicity, but in production you might consider:

- **Socket.io/WebSockets**: Establishes connection for signaling while keeping
  signaling and data separate (essentially replicating WebSocket architecture)
- **HTTP/3 Quic**: Uses UDP like WebRTC, potentially allowing easier connection
  upgrade paths
- **Dedicated Control DataChannel**: 2-stages signaling where it opens one
  always-available DataChannel for control messages (coordination of consumer
  subscriptions)

The choice depends on whether you accept the complexity trade-off for unified
Mediasoup infrastructure.

### Multi-Client Scaling

As clients increase, the memory and state management complexity grows:

- **N Publishers, M Subscribers**: Each publisher's DataProducer needs M
  DirectTransport consumers (one per subscriber), creating O(N×M) state objects
- **Connection Handshakes**: Each new client performs multiple round-trips to
  establish transports, causing startup latency
- **Producer Discovery**: No built-in mechanism to advertise new producers to
  existing subscribers (requires custom signaling logic)

These factors don't significantly impact a 2-3 person chat, but become
problematic at scale.

### Performance Characteristics

**Latency**: Comparable to WebSockets once the WebRTC connection is established,
since data flows through kernel UDP/DTLS → User-space Mediasoup → Application
layer. The transport establishment adds 100-300ms initial overhead.

**Throughput**: Adequate for text messaging; no inherent limitations. SCTP
provides congestion control similar to TCP, making it suitable for reliable bulk
transfers.

**Resource Usage**: Each transport pair (send + receive) maintains kernel
buffers, Mediasoup objects, and JavaScript closures. Approximately 500KB-1MB per
connected client when idle.

### When This PoC Principles Apply

This architecture makes sense when:

1. You're already building on Mediasoup infrastructure (audio/video rooms)
2. You need tight integration between data and media streams
3. Your team has deep Mediasoup expertise
4. You can justify the added complexity for your use case

For everything else, WebSockets provide superior simplicity-to-capability ratio.
