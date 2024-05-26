import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import Joi from 'joi';
import { ProcessorModule } from './processor/processor.module';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { LoggingInterceptor } from './common/interceptors';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      isGlobal: true,
      validationSchema: Joi.object({
        NODE_ENV: Joi.valid('development', 'production', 'test').required(),
        HTTP_HOST: Joi.string().required(),
        HTTP_PORT: Joi.number().required(),
        CLIENT_URL: Joi.string().required(),
        SERVICE_TOKEN: Joi.string().required(),
        REDIS_URL: Joi.string().required(),
        RABBITMQ_URL: Joi.string().required(),
        RABBITMQ_QUEUE: Joi.string().required(),
        STORAGE_BASE_URL: Joi.string().required(),
        DATABASE_URL: Joi.string().required(),
        HWACCEL_ENABLED: Joi.boolean().required(),
        GPU_VENDOR: Joi.valid(
          'nvidia',
          'apple',
          'intel',
          'amd',
          'other',
        ).required(),
      }),
    }),
    ProcessorModule,
    HealthModule,
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
  ],
})
export class AppModule {}
