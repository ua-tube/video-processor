export class AddThumbnailEvent {
  public readonly videoId: string
  public readonly thumbnails: any[]

  constructor(videoId: string, thumbnails: any[]) {
    this.videoId = videoId
    this.thumbnails = thumbnails
  }
}
