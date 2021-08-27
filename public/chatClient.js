import {getPayloadError} from 'https://cdn.esm.sh/v45/getpayload@0.0.1/es2021/getpayload.js';
import {Device} from 'https://cdn.esm.sh/v45/mediasoup-client@3.6.37/es2021/lib/Device.js';


function request(path, body)
{
  let init

  if(body !== undefined)
  {
    init = {method: 'POST'}

    if(body != null)
    {
      init.body = JSON.stringify(body)
      init.headers = {'Content-Type': 'application/json'}
    }
  }

  return fetch(path, init).then(getPayloadError)
}


// Create a transport in the server for sending our media through it.
async function createSendTransport(device)
{
  const {
    dtlsParameters, iceCandidates, iceParameters, id, sctpParameters
  } = await request('/', null)

  return device.createSendTransport(
    {dtlsParameters, iceCandidates, iceParameters, id, sctpParameters}
  )
    .on('connect', onConnect)
}

// Create a transport in the server for receiving our media through it.
async function createRecvTransport(device)
{
  const {
    dtlsParameters, iceCandidates, iceParameters, id, sctpParameters
  } = await request('/', null)

  return device.createRecvTransport(
    {dtlsParameters, iceCandidates, iceParameters, id, sctpParameters}
  )
    .on('connect', onConnect)
}


async function produceData(device)
{
  const sendTransport = await createSendTransport(device)

  sendTransport.once('producedata', onProduceData)

  return sendTransport.produceData();
}

async function consumeData(dataProducerId, recvTransport)
{
  const dataConsumerOptions = await request(
    `/${recvTransport.id}/consumeData`, dataProducerId
  )

  return recvTransport.consumeData(dataConsumerOptions);
}


async function onConnect({ dtlsParameters }, callback, errback)
{
  // Here we must communicate our local parameters to our remote transport.
  try
  {
    await request(`/${this.id}/connect`, dtlsParameters)

    // Done in the server, tell our transport.
    callback();
  }
  catch(error)
  {
    // Something was wrong in server side.
    errback(error);
  }
}

async function onProduceData(
  { appData, label, protocol, sctpStreamParameters }, callback, errback
) {
  // Here we must communicate our local parameters to our remote transport.
  try
  {
    const { id } = await request(
      `/${this.id}/produceData`,
      {appData, label, protocol, sctpStreamParameters}
    )

    // Done in the server, pass the response to our transport.
    callback({ id });
  }
  catch (error)
  {
    // Something was wrong in server side.
    errback(error);
  }
}


export default async function()
{
  // Create a new mediasoup Device.
  const device = new Device();

  // Get the Router RTP capabilities and apply them, although we don't use them
  const routerRtpCapabilities = await request('/routerRtpCapabilities')
  await device.load({ routerRtpCapabilities });

  return Promise.all([
    // Produce data (DataChannel)
    produceData(device),
    createRecvTransport(device)
  ])
  .then(async function([dataProducer, recvTransport])
  {
    // Consume data (DataChannel)
    const dataConsumer = await consumeData(dataProducer.id, recvTransport);

    return {dataProducer, dataConsumer}
  })
}
