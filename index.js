import fastifyStatic from "fastify-static";
import { createWorker } from "mediasoup";

const connectSchema = {
  schema: {
    body: {
      type: "object",
      properties: {
        fingerprints: {
          type: "array",
          items: {
            type: "object",
            properties: {
              algorithm: { type: "string" },
              value: { type: "string" },
            },
            required: ["algorithm", "value"],
          },
        },
        role: { type: "string" },
      },
      required: ["fingerprints"],
    },
    response: {
      204: {},
    },
  },
};

const consumeDataSchema = {
  schema: {
    body: {
      type: "string",
    },
    params: {
      type: "object",
      properties: {
        webRtcTransportId: {
          type: "string",
        },
      },
    },
  },
};

const produceDataSchema = {
  schema: {
    body: {
      type: "object",
      properties: {
        appData: {
          type: "object",
        },
        label: {
          type: "string",
        },
        protocol: {
          type: "string",
        },
        sctpStreamParameters: {
          type: "object",
        },
      },
    },
    params: {
      type: "object",
      properties: {
        webRtcTransportId: {
          type: "string",
        },
      },
    },
  },
};

const { pathname: root } = new URL("public", import.meta.url);

export default async function routes(fastify, { announcedIp }) {
  //
  // Serve static files
  //

  fastify.register(fastifyStatic, { root });

  //
  // Signaling endpoints
  //

  const worker = await createWorker();
  const router = await worker.createRouter();

  const directTransportDataConsumers = {};
  const webRtcTransports = {};

  // Get Router RTP capabilities
  fastify.get("/routerRtpCapabilities", async function () {
    return router.rtpCapabilities;
  });

  // Create a WebRtcTransport in the Mediasoup Router
  fastify.post("/", async function () {
    const webRtcTransport = await router.createWebRtcTransport({
      enableSctp: true,
      listenIps: [
        {
          announcedIp,
          ip: fastify.server.address().address,
        },
      ],
    });

    const {
      dtlsParameters,
      iceCandidates,
      iceParameters,
      id,
      observer,
      sctpParameters,
    } = webRtcTransport;

    webRtcTransports[id] = webRtcTransport;

    observer.on("close", function () {
      delete webRtcTransports[id];
    });

    return { dtlsParameters, iceCandidates, iceParameters, id, sctpParameters };
  });

  // WebRtcTransport onConnect event
  fastify.post(
    "/:webRtcTransportId/connect",
    connectSchema,
    async function (
      { body: dtlsParameters, params: { webRtcTransportId } },
      reply,
    ) {
      const webRtcTransport = webRtcTransports[webRtcTransportId];
      if (!webRtcTransport)
        return reply.code(404).send("WebRtcTransport not found");

      reply.code(204);

      return await webRtcTransport.connect({ dtlsParameters });
    },
  );

  // produceData (publish)
  fastify.post(
    "/:webRtcTransportId/produceData",
    produceDataSchema,
    async function ({ body, params: { webRtcTransportId } }, reply) {
      const webRtcTransport = webRtcTransports[webRtcTransportId];
      if (!webRtcTransport)
        return reply.code(404).send("WebRtcTransport not found");

      const [{ id: dataProducerId, observer }, directTransport] =
        await Promise.all([
          webRtcTransport.produceData(body),
          router.createDirectTransport(),
        ]);

      const directTransportDataConsumer = await directTransport.consumeData({
        dataProducerId,
      });

      directTransportDataConsumers[dataProducerId] =
        directTransportDataConsumer;

      observer.on("close", function () {
        delete directTransportDataConsumers[dataProducerId];
      });

      return dataProducerId;
    },
  );

  // consumeData (subscribe)
  fastify.post(
    "/:webRtcTransportId/consumeData",
    consumeDataSchema,
    async function (
      { body: dataProducerId, params: { webRtcTransportId } },
      reply,
    ) {
      const webRtcTransport = webRtcTransports[webRtcTransportId];
      if (!webRtcTransport)
        return reply.code(404).send("WebRtcTransport not found");

      const directTransportDataConsumer =
        directTransportDataConsumers[dataProducerId];
      if (!directTransportDataConsumer)
        return reply.code(404).send("Producer not found");

      const directTransport = await router.createDirectTransport();
      const directTransportDataProducer = await directTransport.produceData();

      const { id: dataProducerId, send } = directTransportDataProducer;

      const { id, label, protocol, sctpStreamParameters } =
        await webRtcTransport.consumeData({ dataProducerId });

      const onMessage = send.bind(directTransportDataProducer);

      directTransportDataConsumer
        .on("message", onMessage)
        .observer.once(
          "close",
          directTransportDataConsumer.off.bind(
            directTransportDataConsumer,
            "message",
            onMessage,
          ),
        );

      return { dataProducerId, id, label, protocol, sctpStreamParameters };
    },
  );
}
