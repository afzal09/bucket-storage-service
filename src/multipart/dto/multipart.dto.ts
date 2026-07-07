export class CompletePartsDto {
  parts: { partNumber: number; etag: string }[];
}

export interface InitiateUploadResultDto {
  uploadId: string;
}

export interface PartInfoDto {
  partNumber: number;
  etag: string;
  size: number;
}
