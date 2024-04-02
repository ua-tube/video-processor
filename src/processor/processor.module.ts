import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma';
import { ProcessorController, HealthController } from './controllers';
import { ProcessorService } from './processor.service';
import { BullModule } from '@nestjs/bull';
import { ConfigService } from '@nestjs/config';
import { Processor } from './processor';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { VIDEO_MANAGER_SVC } from './constants';

@Module({
  imports: [
    PrismaModule,
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        url: configService.get<string>('REDIS_URL'),
      }),
    }),
    BullModule.registerQueue({ name: 'processor' }),
    ClientsModule.registerAsync([
      {
        name: VIDEO_MANAGER_SVC,
        inject: [ConfigService],
        useFactory: (configService: ConfigService) => ({
          transport: Transport.RMQ,
          options: {
            urls: [configService.get<string>('RABBITMQ_URL')],
            queue: configService.get<string>('RABBITMQ_VIDEO_MANAGER_QUEUE'),
            persistent: true,
            queueOptions: {
              durable: false,
            },
          },
        }),
      },
    ]),
  ],
  controllers: [ProcessorController, HealthController],
  providers: [ProcessorService, Processor],
})
export class ProcessorModule {}
