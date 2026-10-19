// Registra il trasporto SMTP Node sul provider condiviso (come
// attachmentStorage/index.ts). Da importare solo dagli entry point Node: il
// Worker registra il proprio trasporto in src/cf/index.ts.
import { setSmtpSocketFactory } from "./provider.js";
import { nodeSmtpSocketFactory } from "./socket.node.js";

setSmtpSocketFactory(nodeSmtpSocketFactory);
