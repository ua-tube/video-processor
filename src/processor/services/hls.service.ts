import { Injectable } from '@nestjs/common';
import { writeFile } from 'node:fs/promises';
import { PlaylistProcessingStep } from '../types';

@Injectable()
export class HlsService {
  async writePlaylist(
    folderPath: string,
    processsingSteps: PlaylistProcessingStep[],
  ): Promise<string> {
    let m3u8Playlist = `#EXTM3U
#EXT-X-VERSION:3`;
    for (const step of processsingSteps) {
      m3u8Playlist += `
#EXT-X-STREAM-INF:BANDWIDTH=${step.bitrate}000,RESOLUTION=${step.width}x${step.height}
${step.hlsId}/${step.label}.m3u8`;
    }
    const m3u8Path = `${folderPath}/master.m3u8`;
    await writeFile(m3u8Path, m3u8Playlist);

    return m3u8Path;
  }
}
