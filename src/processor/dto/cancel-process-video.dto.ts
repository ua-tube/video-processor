import { IsNotEmpty, IsUUID } from 'class-validator';

export class CancelProcessVideoDto {
  @IsNotEmpty()
  @IsUUID(4)
  videoId: string;
}
