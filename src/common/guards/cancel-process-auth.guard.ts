import { CanActivate, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export class CancelProcessAuthGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();

    return (
      req.headers?.token &&
      req.headers.token === this.configService.get('SERVICE_TOKEN')
    );
  }
}
