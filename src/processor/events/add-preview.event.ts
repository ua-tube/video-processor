export class AddPreviewEvent {
  public readonly imageFileId: string
  public readonly url: string
  public readonly videoId: string

  constructor(imageFileId: string, url: string, videoId: string) {
    this.imageFileId = imageFileId
    this.url = url
    this.videoId = videoId
  }
}
