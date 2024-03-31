import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import Joi from 'joi';
import { ProcessorModule } from './processor/processor.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      isGlobal: true,
      validationSchema: Joi.object({
        NODE_ENV: Joi.valid('development', 'production', 'test').required(),
        HTTP_HOST: Joi.string().required(),
        HTTP_PORT: Joi.number().required(),
        REDIS_URL: Joi.string().required(),
        RABBITMQ_URL: Joi.string().required(),
        RABBITMQ_QUEUE: Joi.string().required(),
        STORAGE_BASE_URL: Joi.string().required(),
        DATABASE_URL: Joi.string().required(),
        HWACCEL_ENABLED: Joi.boolean().required(),
        GPU_VENDOR: Joi.valid('nvidia', 'apple', 'intel', 'amd', 'other').required()
      }),
    }),
    ProcessorModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
