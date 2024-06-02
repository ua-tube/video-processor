import { Injectable, Logger } from '@nestjs/common';
import { join } from 'node:path';
import { mkdir, readdir } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { promisify } from 'node:util';
import { finished } from 'stream';
import { randomUUID } from 'node:crypto';
import FormData from 'form-data';
import { SERVICE_UPLOADED_VIDEO } from '../constants';

@Injectable()
export class NetworkService {
  private readonly logger = new Logger(NetworkService.name);
  private readonly streamFinished = promisify(finished);

  constructor(private readonly configService: ConfigService) {}

  async downloadVideo(videoUrl: string) {
    const [folderId, fileExt] = videoUrl.split('/').at(-1).split('.');
    const outputFolderPath = join(process.cwd(), 'processor_output', folderId);
    const filePath = join(outputFolderPath, `video.${fileExt}`);

    await mkdir(outputFolderPath, { recursive: true });

    const writer = createWriteStream(filePath);

    const response = await axios.get(
      this.configService.get<string>('STORAGE_BASE_URL') + videoUrl,
      { responseType: 'stream' },
    );

    response.data.pipe(writer);
    await this.streamFinished(writer);

    this.logger.log(`Video to processing downloaded from URI ${videoUrl}`);

    return { filePath, outputFolderPath, folderId };
  }

  async uploadHlsMaster(filePath: string, groupId: string, hlsId?: string) {
    const masterFormData = new FormData();

    const masterReadStream = createReadStream(filePath);
    masterFormData.append('file', masterReadStream);

    const { data } = await axios.post<{ filename: string }>(
      this.configService.get<string>('STORAGE_BASE_URL') +
        `/api/v1/storage/videos/internal/hls/master`,
      masterFormData,
      {
        headers: {
          token: this.configService.get<string>('STORAGE_SERVICE_TOKEN'),
          'group-id': groupId,
          ...(hlsId && { 'hls-id': hlsId }),
          category: SERVICE_UPLOADED_VIDEO,
          ...masterFormData.getHeaders(),
        },
      },
    );

    return data.filename;
  }

  async uploadHls(folderPath: string, groupId: string) {
    const filenames = await readdir(folderPath);

    if (!filenames || !filenames.length) return;

    const masterFilename = filenames.find((filename) =>
      filename.endsWith('.m3u8'),
    );
    const hlsFilenames = filenames.filter((filename) =>
      filename.endsWith('.ts'),
    );

    if (!masterFilename || !hlsFilenames.length) return;

    const hlsId = randomUUID();
    const generatedMasterFilename = await this.uploadHlsMaster(
      join(folderPath, masterFilename),
      groupId,
      hlsId,
    );

    const step = 500;
    for (let start = 0; start < hlsFilenames.length; start += step) {
      const hlsFormData = new FormData();
      hlsFilenames.slice(start, start + step).forEach((hlsFilename) => {
        const hlsReadStream = createReadStream(join(folderPath, hlsFilename));
        hlsFormData.append('files', hlsReadStream);
      });

      await axios.post(
        this.configService.get<string>('STORAGE_BASE_URL') +
          `/api/v1/storage/videos/internal/hls/segments`,
        hlsFormData,
        {
          headers: {
            token: this.configService.get<string>('STORAGE_SERVICE_TOKEN'),
            'group-id': groupId,
            'hls-id': hlsId,
            category: SERVICE_UPLOADED_VIDEO,
            ...hlsFormData.getHeaders(),
          },
        },
      );
    }

    return {
      url: `/videos/${SERVICE_UPLOADED_VIDEO}/${groupId}/${hlsId}/${generatedMasterFilename}`,
      hlsId
    }
  }

  async uploadImage(filePath: string, groupId: string, category: string) {
    const formData = new FormData();

    const imageReadStream = createReadStream(filePath);
    formData.append('file', imageReadStream);

    const { data } = await axios.post(
      this.configService.get<string>('STORAGE_BASE_URL') +
        `/api/v1/storage/images/internal`,
      formData,
      {
        headers: {
          token: this.configService.get<string>('STORAGE_SERVICE_TOKEN'),
          'file-id': randomUUID(),
          'group-id': groupId,
          category,
          ...formData.getHeaders(),
        },
      },
    );

    return { id: data.id, url: data.url };
  }
}
