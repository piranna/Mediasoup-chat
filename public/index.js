import chatClient from './chatClient.js'


const {dataProducer, dataConsumer} = await chatClient()


const message  = document.getElementById('message' );
const messages = document.getElementById('messages');

function send()
{
  dataProducer.send(message.value)

  message.value = '';
}

document.getElementById('send').addEventListener('click', send)

message.addEventListener("keyup", function({key})
{
  if (key === "Enter") send()
})


dataConsumer.on('message', function(data)
{
  const span = document.createElement('span')

  span.appendChild(document.createTextNode(data))

  messages.appendChild(span)
})
