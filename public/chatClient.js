import { getPayloadError } from "https://esm.sh/getpayload@0.0.1/es2022/getpayload.mjs";
import { Device } from "https://esm.sh/mediasoup-client@3.20.0/es2022/lib/Device.mjs";

async function request(path, body) {
  let init;

  if (body !== undefined) {
    init = { method: "POST" };

    if (body != null) {
      init.body = JSON.stringify(body);
      init.headers = { "Content-Type": "application/json" };
    }
  }

  const response = await fetch(path, init);

  return await getPayloadError(response);
}

/**
 * Create a transport in the server for sending our media through it.
 */
async function createSendTransport(device) {
  const { dtlsParameters, iceCandidates, iceParameters, id, sctpParameters } =
    await request("/", null);

  return device
    .createSendTransport({
      dtlsParameters,
      iceCandidates,
      iceParameters,
      id,
      sctpParameters,
    })
    .on("connect", onConnect);
}

/**
 * Create a transport in the server for receiving our media through it.
 */
async function createRecvTransport(device) {
  const { dtlsParameters, iceCandidates, iceParameters, id, sctpParameters } =
    await request("/", null);

  return device
    .createRecvTransport({
      dtlsParameters,
      iceCandidates,
      iceParameters,
      id,
      sctpParameters,
    })
    .on("connect", onConnect);
}

// Callbacks for mediasoup-client events.

function onConnect({ dtlsParameters }, callback, errback) {
  // Here we must communicate our local parameters to our remote transport.
  void request(`/${this.id}/connect`, dtlsParameters).then(
    callback, // Done in the server, tell our transport.
    errback, // Something was wrong in server side.
  );
}

function onProduceData(
  { appData, label, protocol, sctpStreamParameters },
  callback,
  errback,
) {
  function onfullfilled(id) {
    callback({ id });
  }

  // Here we must communicate our local parameters to our remote transport.
  void request(`/${this.id}/produceData`, {
    appData,
    label,
    protocol,
    sctpStreamParameters,
  }).then(
    onfullfilled, // Done in the server, pass the response to our transport.
    errback, // Something was wrong in server side.
  );
}

// Now we can use the DataProducer and DataConsumer to send and receive data.

async function produceData(device) {
  const sendTransport = await createSendTransport(device);

  sendTransport.once("producedata", onProduceData);

  return sendTransport.produceData();
}

async function consumeData(dataProducerId, recvTransport) {
  const dataConsumerOptions = await request(
    `/${recvTransport.id}/consumeData`,
    dataProducerId,
  );

  return recvTransport.consumeData(dataConsumerOptions);
}

/**
 * Initialize the chat client by creating the necessary transports and
 * producers/consumers.
 *
 * @returns {Promise<{ dataProducer: DataProducer, dataConsumer: DataConsumer }>}
 * An object containing the data producer and consumer for the chat client.
 *
 * @throws Will throw an error if there is an issue with the server
 * communication or media setup.
 */
export default async function () {
  // Get the Router RTP capabilities from server, although we will not use them
  const routerRtpCapabilities = await request("/routerRtpCapabilities");

  // Create a new mediasoup Device.
  const device = new Device();

  const [, dataProducer, recvTransport] = await Promise.all([
    device.load({ routerRtpCapabilities }), // Apply the Router RTP capabilities
    produceData(device), // Produce data (DataChannel)
    createRecvTransport(device), // Create a transport for receiving data
  ]);

  // Consume data (DataChannel)
  const dataConsumer = await consumeData(dataProducer.id, recvTransport);

  // Now everything is ready for us to consume and produce data.
  return { dataProducer, dataConsumer };
}
