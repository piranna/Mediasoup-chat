import fastifyStatic from 'fastify-static'
import {createWorker} from 'mediasoup'


const connectSchema =
{
  schema: {
    body: {
      type: 'object',
      properties: {
        fingerprints: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              algorithm: { type: 'string' },
              value: { type: 'string' },
            },
            required: ['algorithm', 'value'],
          },
        },
        role: { type: 'string' }
      },
      required: ['fingerprints']
    },
    response: {
      204: {}
    }
  }
}


export default async function routes (fastify, {announcedIp}) {
  //
  // Serve static files
  //

  fastify.register(fastifyStatic, {
    root: new URL('public', import.meta.url).pathname,
  })


  //
  // Signaling endpoints
  //

  const worker = await createWorker()
  const router = await worker.createRouter()

  const transports = {}
  const dataProducers = {}

  // Get Router RTP capabilities
  fastify.get('/routerRtpCapabilities', async function(request, reply)
  {
    return router.rtpCapabilities
  })

  // Create a WebRtcTransport in the Mediasoup Router
  fastify.post('/', async function(request, reply)
  {
    const transport = await router.createWebRtcTransport(
      {
        enableSctp: true,
        listenIps: [
          {
            announcedIp,
            ip: fastify.server.address().address
          }
        ]
      }
    )

    const {
      dtlsParameters, iceCandidates, iceParameters, id, observer, sctpParameters
    } = transport

    transports[id] = transport

    observer.on('close', function()
    {
      delete transports[id]
    })

    return {dtlsParameters, iceCandidates, iceParameters, id, sctpParameters}
  })

  // Transport onConnect event
  fastify.post(
    '/:transportId/connect',
    connectSchema,
    async function ({body: dtlsParameters, params: {transportId}}, reply)
    {
      const transport = transports[transportId]
      if (!transport) return reply.code(404).send('Transport not found')

      reply.code(204)
      return transport.connect({dtlsParameters})
    }
  )

  // produceData
  fastify.post(
    '/:transportId/produceData',
    async function ({body, params: {transportId}}, reply)
    {
      const transport = transports[transportId]
      if (!transport) return reply.code(404).send('Transport not found')

      const dataProducer = await transport.produceData(body);

      const {id, observer} = dataProducer

      dataProducers[id] = dataProducer

      observer.on('close', function()
      {
        delete dataProducers[id]
      })

      return {id}
    }
  )

  // consumeData
  fastify.post(
    '/:transportId/consumeData',
    async function({body: dataProducerId, params: {transportId}}, reply)
    {
      const transport = transports[transportId]
      if (!transport) return reply.code(404).send('Transport not found')

      const dataProducer = dataProducers[dataProducerId]
      if (!dataProducer) return reply.code(404).send('Producer not found')

      const dataConsumer = await transport.consumeData({dataProducerId})

      return {
        dataProducerId      : dataConsumer.dataProducerId,
        id                  : dataConsumer.id,
        label               : dataConsumer.label,
        protocol            : dataConsumer.protocol,
        sctpStreamParameters: dataConsumer.sctpStreamParameters
      }
    }
  )
}
