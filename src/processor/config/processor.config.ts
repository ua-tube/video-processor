export const VIDEO_PROCESSOR_CONFIG = {
  retryDelayMs: 60000,
  maxRetryCount: 5,
};

export const GENERATOR_CONFIG = {
  hardwareAccelerator: 'auto',
  hardwareAccelerationEncoder: {
    nvidia: 'h264_nvenc',
    apple: 'h264_videotoolbox',
  },
  hls: {
    segmentTime: 60,
    playlistType: 'vod',
  },
};

export const PREVIEW_CONFIG = {
  previewThumbnailHeight: 320,
  previewThumbnailStartPosition: 0.33,
  previewThumbnailLengthSeconds: 3.0,
};

export const RESOLUTIONS = [
  { label: '144p', height: 144, bitrate: 600 },
  { label: '240p', height: 240, bitrate: 1000 },
  { label: '360p', height: 360, bitrate: 1400 },
  { label: '480p', height: 480, bitrate: 1800 },
  { label: '720p', height: 720, bitrate: 4000 },
  { label: '1080p', height: 1080, bitrate: 10000 },
  { label: '1440p', height: 1440, bitrate: 20000 },
  { label: '2160p', height: 2160, bitrate: 50000 },
  { label: '4320p', height: 4320, bitrate: 100000 },
];
