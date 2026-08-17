import type { IncomingMessage, ServerResponse } from "http";
import { createApp } from "../server";

const app = createApp();

export default function handler(req: IncomingMessage, res: ServerResponse) {
  return app(req as any, res as any);
}
