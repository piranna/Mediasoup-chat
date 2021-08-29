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

const consumeDataSchema =
{
  schema: {
    body: {
      type: 'string'
    },
    params: {
      type: 'object',
      properties: {
        transportId: {
          type: 'string'
        }
      }
    }
  }
}

const produceDataSchema =
{
  schema: {
    body: {
      type: 'object',
      properties: {
        appData: {
          type: 'object'
        },
        label: {
          type: 'string'
        },
        protocol: {
          type: 'string'
        },
        sctpStreamParameters: {
          type: 'object'
        }
      }
    },
    params: {
      type: 'object',
      properties: {
        transportId: {
          type: 'string'
        }
      }
    }
  }
}

const {pathname: root} = new URL('public', import.meta.url)


export default async function routes (fastify, {announcedIp}) {
  //
  // Serve static files
  //

  fastify.register(fastifyStatic, {root})


  //
  // Signaling endpoints
  //

  const worker = await createWorker()
  const router = await worker.createRouter()

  const transports = {}
  const directTransportDataConsumers = {}

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

  // produceData (publish)
  fastify.post(
    '/:transportId/produceData',
    produceDataSchema,
    async function ({body, params: {transportId}}, reply)
    {
      const transport = transports[transportId]
      if (!transport) return reply.code(404).send('Transport not found')

      const dataProducer = await transport.produceData(body);

      const {id, observer} = dataProducer

      const directTransport = await router.createDirectTransport()
      const directTransportDataConsumer = await directTransport.consumeData(
        {dataProducerId: id}
      )

      directTransportDataConsumers[id] = directTransportDataConsumer

      observer.on('close', function()
      {
        delete directTransportDataConsumers[id]
      })

      return {id}
    }
  )

  // consumeData (subscribe)
  fastify.post(
    '/:transportId/consumeData',
    consumeDataSchema,
    async function({body: dataProducerId, params: {transportId}}, reply)
    {
      const transport = transports[transportId]
      if (!transport) return reply.code(404).send('Transport not found')

      const directTransportDataConsumer = directTransportDataConsumers[
        dataProducerId
      ]
      if (!directTransportDataConsumer)
        return reply.code(404).send('Producer not found')

      const directTransport = await router.createDirectTransport()
      const directTransportDataProducer = await directTransport.produceData()

      const dataConsumer = await transport.consumeData(
        {dataProducerId: directTransportDataProducer.id}
      )

      const onMessage = directTransportDataProducer.send.bind(
        directTransportDataProducer
      )
      // function onMessage(message, ppid)
      // {
      //   console.info(message, ppid)
      //   directTransportDataProducer.send(message, ppid)
      // }

      directTransportDataConsumer
        .on('message', onMessage)
        .observer.once(
          'close',
          directTransportDataConsumer.off.bind(
            directTransportDataConsumer, 'message', onMessage
          )
        )

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
