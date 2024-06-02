export class AddProcessedVideoEvent {
  videoId: string;
  label: string;
  lengthSeconds: number | null;

  constructor(
    videoId: string,
    label: string,
    lengthSeconds: number | null,
  ) {
    this.videoId = videoId;
    this.label = label;
    this.lengthSeconds = lengthSeconds;
  }
}
