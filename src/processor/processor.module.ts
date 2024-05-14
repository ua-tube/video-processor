import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma';
import { ProcessorController } from './processor.controller';
import { ProcessorService } from './processor.service';
import { BullModule } from '@nestjs/bull';
import { ConfigService } from '@nestjs/config';
import { Processor } from './processor';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { VIDEO_MANAGER_SVC } from './constants';
import { CacheModule } from '@nestjs/cache-manager';
import { redisStore } from 'cache-manager-redis-yet';
import { EventEmitterModule } from '@nestjs/event-emitter';

@Module({
  imports: [
    PrismaModule,
    EventEmitterModule.forRoot(),
    CacheModule.registerAsync({
      inject: [ConfigService],
      isGlobal: true,
      useFactory: async (configService: ConfigService) => ({
        store: await redisStore({
          url: configService.get<string>('REDIS_URL'),
          ttl: 1000 * 3600 * 2,
        }),
        max: 5000,
      }),
    }),
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
  controllers: [ProcessorController],
  providers: [ProcessorService, Processor],
})
export class ProcessorModule {}
