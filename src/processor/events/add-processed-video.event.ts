export class AddProcessedVideoEvent {
  public readonly videoFileId: string;
  public readonly videoId: string;
  public readonly url: string;
  public readonly label: string;

  constructor(
    videoFileId: string,
    videoId: string,
    url: string,
    label: string,
  ) {
    this.videoFileId = videoFileId;
    this.videoId = videoId;
    this.url = url;
    this.label = label;
  }
}
