import type { WebcamServiceHandler } from '../../../../src/generated/server/osintview/webcam/v1/service_server';
import { listWebcams } from './list-webcams';
import { getWebcamImage } from './get-webcam-image';

export const webcamHandler: WebcamServiceHandler = {
  listWebcams,
  getWebcamImage,
};
