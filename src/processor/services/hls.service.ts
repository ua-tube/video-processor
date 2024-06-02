import { Injectable } from '@nestjs/common';
import { writeFile } from 'node:fs/promises';

@Injectable()
export class HlsService {
  writePlaylist(masterFilePath: string, resolutions: any[]) {
    return new Promise(async (resolve) => {
      let m3u8Playlist = `#EXTM3U
#EXT-X-VERSION:3`;
      for (const r of resolutions) {
        m3u8Playlist += `
#EXT-X-STREAM-INF:BANDWIDTH=${r.bitrate}k,RESOLUTION=${r.width}x${r.height}
${r.height}.m3u8`;
      }
      const m3u8Path = `${masterFilePath}/master.m3u8`;
      await writeFile(m3u8Path, m3u8Playlist);

      resolve(m3u8Path);
    });
  }
}
