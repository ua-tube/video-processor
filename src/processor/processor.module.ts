import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma';
import { ProcessorController } from './processor.controller';
import { ProcessorService } from './processor.service';
import { BullModule } from '@nestjs/bull';
import { ConfigService } from '@nestjs/config';
import { Processor } from './processor';

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
  ],
  controllers: [ProcessorController],
  providers: [ProcessorService, Processor],
})
export class ProcessorModule {}
