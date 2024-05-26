export class AddProcessedVideoEvent {
  videoId: string;
  videoFileId: string;
  url: string;
  label: string;
  width: number;
  height: number;
  lengthSeconds: number | null;
  size: string | number | bigint;

  constructor(
    videoId: string,
    videoFileId: string,
    url: string,
    label: string,
    width: number,
    height: number,
    lengthSeconds: number | null,
    size: string | number | bigint,
  ) {
    this.videoId = videoId;
    this.videoFileId = videoFileId;
    this.url = url;
    this.label = label;
    this.width = width;
    this.height = height;
    this.lengthSeconds = lengthSeconds;
    this.size = size;
  }
}
