import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GENERATOR_CONFIG } from '../config';
import ffmpeg from 'fluent-ffmpeg';
import { join } from 'node:path';

@Injectable()
export class FfmpegService {
  private readonly runningCommands = new Map<string, ffmpeg.FfmpegCommand>();

  constructor(private readonly configService: ConfigService) {}

  get ffmpeg() {
    return ffmpeg;
  }

  get runnningCommands() {
    return this.runningCommands;
  }

  setCommand(key: string, value: ffmpeg.FfmpegCommand) {
    this.runningCommands.set(key, value);
  }

  deleteCommand(key: string) {
    this.runningCommands.delete(key);
  }

  probe(filePath: string): Promise<ffmpeg.FfprobeData> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, data) => {
        if (err) reject(err);
        else resolve(data);
      });
    });
  }

  buildInputOption() {
    return this.hwaccelEnabled
      ? [`-hwaccel ${GENERATOR_CONFIG.hardwareAccelerator}`]
      : [];
  }

  buildTranscodeOutputOption(
    width: number,
    height: number,
    bitrate: number,
    videoHaveAudioTrack: boolean,
  ) {
    const args: string[] = [
      `-s ${width}x${height}`,
      `-b:v ${bitrate}k`,
      `-c:v ${this.getHwaccelEncoder()}`,
    ];
    return videoHaveAudioTrack ? [...args, '-c:a aac'] : args;
  }

  buildPreviewOutputOption(
    width: number,
    height: number,
    startPositionSeconds: number,
    lengthSeconds: number,
  ): string[] {
    return [
      `-s ${width}x${height}`,
      '-r 12.000',
      '-loop 0',
      '-c:v webp',
      `-ss ${this.toFFmpegTime(startPositionSeconds)}`,
      `-t ${this.toFFmpegTime(lengthSeconds)}`,
    ];
  }

  buildHlsOutputOptions(hlsFolder: string, label: string): string[] {
    return [
      `-c:v ${this.getHwaccelEncoder()}`,
      `-hls_time ${GENERATOR_CONFIG.hls.segmentTime}`,
      `-hls_playlist_type ${GENERATOR_CONFIG.hls.playlistType}`,
      `-hls_segment_filename ${join(hlsFolder, `${label}_%04d.ts`)}`,
    ];
  }

  private toFFmpegTime(positionSeconds: number): string {
    const timespan = new Date(
      positionSeconds && !isNaN(positionSeconds) ? positionSeconds * 1000 : 0,
    );
    const hours = timespan.getUTCHours();
    const minutes = timespan.getUTCMinutes();
    const seconds = timespan.getUTCSeconds();
    const milliseconds = timespan.getUTCMilliseconds();

    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
  }

  private getHwaccelEncoder() {
    if (this.hwaccelEnabled) {
      const vendorName = this.configService.get<string>('GPU_VENDOR');
      return (
        GENERATOR_CONFIG.hardwareAccelerationEncoder?.[
          vendorName.toLowerCase()
        ] || 'h264'
      );
    }

    return 'h264';
  }

  private get hwaccelEnabled() {
    return this.configService.get<boolean>('HWACCEL_ENABLED');
  }
}
