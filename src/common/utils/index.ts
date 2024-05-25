import { RmqContext } from '@nestjs/microservices';

export const ackMessage = (context: RmqContext) => {
  const channel = context.getChannelRef();
  const originalMsg = context.getMessage();

  channel.ack(originalMsg);
};
