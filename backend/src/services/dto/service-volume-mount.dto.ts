export interface ServiceVolumeMountDto {
  composeService: string;
  mountType: 'bind' | 'volume' | 'tmpfs' | 'unknown';
  source: string;
  target: string;
  readOnly: boolean;
  /** Project-prefixed Docker volume name when mountType is volume (e.g. myapp_data). */
  hostVolumeName?: string;
}

export interface ServiceVolumesResponseDto {
  items: ServiceVolumeMountDto[];
  /** Set when compose config could not be produced (invalid YAML, missing Docker, etc.). */
  error?: string;
}
