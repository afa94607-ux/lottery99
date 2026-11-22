import { BetTicket } from '../types/lottery';
import { formatKHR, LOTTERY_PAYOUT_RATE } from './formatters';

export type WebPrinterState = 'disconnected' | 'connecting' | 'connected' | 'printing' | 'error';

export interface WebPrinterStatus {
  supported: boolean;
  state: WebPrinterState;
  deviceLabel: string;
  error?: string;
}

interface SerialPortLike {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  getInfo?: () => { usbVendorId?: number; usbProductId?: number; bluetoothServiceClassId?: string };
  addEventListener?: (type: string, listener: () => void) => void;
}

interface NavigatorSerialLike {
  getPorts(): Promise<SerialPortLike[]>;
  requestPort(options?: { allowedBluetoothServiceClassIds?: string[] }): Promise<SerialPortLike>;
  addEventListener?: (type: string, listener: (e: unknown) => void) => void;
}

const SPP_UUID = '00001101-0000-1000-8000-00805f9b34fb';
let activePort: SerialPortLike | null = null;
let isPrintingMutex = false;

export function isWebSerialSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serial' in navigator;
}

function getSerial(): NavigatorSerialLike | null {
  if (!isWebSerialSupported()) return null;
  return (navigator as unknown as { serial: NavigatorSerialLike }).serial;
}

export async function getRememberedWebPrinter(): Promise<WebPrinterStatus> {
  if (!isWebSerialSupported()) {
    return { supported: false, state: 'disconnected', deviceLabel: '' };
  }
  if (activePort && activePort.writable) {
    return { supported: true, state: 'connected', deviceLabel: 'Bluetooth Printer (Connected)' };
  }
  try {
    const serial = getSerial();
    const ports = (await serial?.getPorts()) || [];
    if (ports.length > 0) {
      activePort = ports[0];
      return { supported: true, state: 'disconnected', deviceLabel: 'Saved Bluetooth Printer (Ready)' };
    }
  } catch {
    // ignore permission query error
  }
  return { supported: true, state: 'disconnected', deviceLabel: '' };
}

export async function connectWebBluetoothPrinter(): Promise<WebPrinterStatus> {
  const serial = getSerial();
  if (!serial) {
    return {
      supported: false,
      state: 'error',
      deviceLabel: '',
      error: 'Web Serial is not supported in this browser. Use Print for Android Print Service.',
    };
  }
  try {
    if (!activePort) {
      const existing = await serial.getPorts();
      if (existing.length > 0) {
        activePort = existing[0];
      } else {
        try {
          activePort = await serial.requestPort({
            allowedBluetoothServiceClassIds: [SPP_UUID],
          });
        } catch {
          activePort = await serial.requestPort();
        }
      }
    }
    if (!activePort.writable) {
      await activePort.open({ baudRate: 9600 });
    }
    activePort.addEventListener?.('disconnect', () => {
      activePort = null;
    });
    return {
      supported: true,
      state: 'connected',
      deviceLabel: 'HOiN / Bluetooth Printer (SPP)',
    };
  } catch (e) {
    activePort = null;
    return {
      supported: true,
      state: 'error',
      deviceLabel: '',
      error: e instanceof Error ? e.message : 'Could not connect to Bluetooth printer.',
    };
  }
}

export async function selectNewWebBluetoothPrinter(): Promise<WebPrinterStatus> {
  const serial = getSerial();
  if (!serial) {
    return {
      supported: false,
      state: 'error',
      deviceLabel: '',
      error: 'Web Serial is not supported in this browser.',
    };
  }
  try {
    await disconnectWebBluetoothPrinter();
    try {
      activePort = await serial.requestPort({
        allowedBluetoothServiceClassIds: [SPP_UUID],
      });
    } catch {
      activePort = await serial.requestPort();
    }
    await activePort.open({ baudRate: 9600 });
    activePort.addEventListener?.('disconnect', () => {
      activePort = null;
    });
    return {
      supported: true,
      state: 'connected',
      deviceLabel: 'HOiN / Bluetooth Printer (SPP)',
    };
  } catch (e) {
    activePort = null;
    return {
      supported: true,
      state: 'error',
      deviceLabel: '',
      error: e instanceof Error ? e.message : 'Printer selection cancelled or failed.',
    };
  }
}

export async function disconnectWebBluetoothPrinter(): Promise<WebPrinterStatus> {
  if (activePort) {
    try {
      await activePort.close();
    } catch {
      // ignore close errors
    }
    activePort = null;
  }
  return {
    supported: isWebSerialSupported(),
    state: 'disconnected',
    deviceLabel: '',
  };
}

function canvasToEscPosRaster(canvas: HTMLCanvasElement): Uint8Array {
  const width = canvas.width;
  const height = canvas.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable.');

  const imgData = ctx.getImageData(0, 0, width, height).data;
  const widthBytes = Math.ceil(width / 8);
  const rasterSize = widthBytes * height;

  const header = new Uint8Array([
    0x1b, 0x40,
    0x1d, 0x76, 0x30, 0x00,
    widthBytes & 0xff, (widthBytes >> 8) & 0xff,
    height & 0xff, (height >> 8) & 0xff,
  ]);
  const footer = new Uint8Array([0x1b, 0x64, 0x05]);
  const out = new Uint8Array(header.length + rasterSize + footer.length);
  out.set(header, 0);

  let offset = header.length;
  for (let y = 0; y < height; y++) {
    for (let xByte = 0; xByte < widthBytes; xByte++) {
      let byteVal = 0;
      for (let bit = 0; bit < 8; bit++) {
        const x = xByte * 8 + bit;
        if (x < width) {
          const idx = (y * width + x) * 4;
          const lum = 0.299 * imgData[idx] + 0.587 * imgData[idx + 1] + 0.114 * imgData[idx + 2];
          if (lum < 165) {
            byteVal |= 1 << (7 - bit);
          }
        }
      }
      out[offset++] = byteVal;
    }
  }
  out.set(footer, offset);
  return out;
}

function drawWrappedNumbers(
  ctx: CanvasRenderingContext2D,
  numbers: string[],
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number
): number {
  let line = '';
  let curY = y;
  for (const num of numbers) {
    const test = line ? `${line}  ${num}` : num;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, curY);
      line = num;
      curY += lineHeight;
    } else {
      line = test;
    }
  }
  if (line) {
    ctx.fillText(line, x, curY);
    curY += lineHeight;
  }
  return curY;
}

function drawBarcodePattern(
  ctx: CanvasRenderingContext2D,
  seedStr: string,
  y: number,
  canvasWidth: number
): number {
  const marginX = 32;
  const barWidth = canvasWidth - marginX * 2;
  const barHeight = 64;
  let bx = marginX;
  let idx = 0;
  while (bx < marginX + barWidth - 6) {
    const code = seedStr.charCodeAt(idx % seedStr.length);
    const wBar = ((code % 3) + 1) * 2; // Crisp 2px, 4px, 6px bars for accurate thermal scanning
    const gap = (((code >> 2) % 2) + 1) * 2;
    ctx.fillRect(bx, y, wBar, barHeight);
    bx += wBar + gap;
    idx++;
  }
  const textY = y + barHeight + 8;
  ctx.textAlign = 'center';
  ctx.font = 'bold 18px monospace';
  ctx.fillText(seedStr, canvasWidth / 2, textY);
  return textY + 26;
}

export function build58mmReceiptCanvas(
  ticket: BetTicket,
  payoutRate: number = LOTTERY_PAYOUT_RATE
): HTMLCanvasElement {
  const width = 384; // Full 58mm 384-dot printable width
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = 2200;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable.');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, canvas.height);
  ctx.fillStyle = '#000000';
  ctx.textBaseline = 'top';

  const isPreview = !ticket.ticketId || ticket.ticketId.startsWith('PREVIEW-');
  const dashes = '-------------------------';
  let y = 12;

  const drawDivider = () => {
    ctx.textAlign = 'left';
    ctx.font = 'bold 20px monospace';
    ctx.fillText(dashes, 8, y);
    y += 24;
  };
  const drawRow = (label: string, value: string, fontSize = 21, rowH = 29) => {
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText(label, 8, y);
    ctx.textAlign = 'right';
    ctx.fillText(value, width - 8, y);
    y += rowH;
  };

  ctx.textAlign = 'center';
  ctx.font = 'bold 34px sans-serif';
  ctx.fillText('ឆ្នោតសំណាង 1/99', width / 2, y);
  y += 42;

  ctx.font = 'bold 19px sans-serif';
  ctx.fillText(isPreview ? 'PREVIEW ONLY — NOT AN OFFICIAL BET' : 'LOTTERY888 OFFICIAL RECEIPT', width / 2, y);
  y += 26;

  ctx.font = 'bold 18px monospace';
  ctx.fillText(ticket.createdAt, width / 2, y);
  y += 26;

  drawDivider();
  drawRow('លេខសំបុត្រ:', ticket.ticketId);
  drawRow('វេនចាប់រង្វាន់:', ticket.roundId);
  drawRow('ប៉ុស្តិ៍:', ticket.channels.join(', '));
  drawRow('ចំនួនលេខ:', `${ticket.numbers.length} លេខ`);
  drawDivider();

  ctx.textAlign = 'left';
  ctx.font = 'bold 21px sans-serif';
  ctx.fillText('បញ្ជីលេខ:', 8, y);
  y += 28;

  ctx.font = 'bold 26px monospace';
  y = drawWrappedNumbers(ctx, ticket.numbers, 8, y, width - 16, 34);
  y += 6;

  drawDivider();
  drawRow('តម្លៃ 1 លេខ:', formatKHR(ticket.stakePerUnit));
  drawRow('សរុបភ្នាល់:', `${ticket.totalBetsCount} ភ្នាល់`);
  drawRow('សរុបទឹកប្រាក់:', formatKHR(ticket.totalCost), 24, 34);
  drawRow(`ឈ្នះ 1 ប៉ុស្តិ៍ (1:${payoutRate}):`, formatKHR(ticket.stakePerUnit * payoutRate), 20, 28);

  if (!isPreview && ticket.status !== 'PENDING') {
    drawDivider();
    ctx.textAlign = 'center';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText(
      ticket.status === 'WON' ? `បានឈ្នះ: ${formatKHR(ticket.wonAmount)}` : 'មិនត្រូវរង្វាន់',
      width / 2,
      y
    );
    y += 32;
  }

  drawDivider();
  y = drawBarcodePattern(ctx, `${ticket.ticketId}*199`, y, width);
  ctx.textAlign = 'center';
  ctx.font = 'bold 17px sans-serif';
  ctx.fillText(
    isPreview ? 'សម្រាប់ពិនិត្យប៉ុណ្ណោះ — មិនទាន់ភ្នាល់' : 'សូមរក្សាទុកសំបុត្រនេះដើម្បីបើករង្វាន់',
    width / 2,
    y
  );
  y += 30;

  const finalHeight = Math.min(2200, Math.max(260, Math.ceil(y + 16)));
  const trimmed = document.createElement('canvas');
  trimmed.width = width;
  trimmed.height = finalHeight;
  const tCtx = trimmed.getContext('2d')!;
  tCtx.drawImage(canvas, 0, 0, width, finalHeight, 0, 0, width, finalHeight);
  return trimmed;
}

export async function printTicketViaWebSerial(
  ticket: BetTicket,
  payoutRate: number = LOTTERY_PAYOUT_RATE
): Promise<{ bytesSent: number }> {
  if (!ticket.ticketId || ticket.ticketId.startsWith('PREVIEW-')) {
    throw new Error('Preview only — confirm your bet first before printing an official receipt.');
  }
  if (isPrintingMutex) {
    throw new Error('Print job already in progress. Please wait.');
  }
  isPrintingMutex = true;
  try {
    if (!activePort || !activePort.writable) {
      const conn = await connectWebBluetoothPrinter();
      if (conn.state !== 'connected' || !activePort?.writable) {
        throw new Error(conn.error || 'Printer is not connected.');
      }
    }
    const canvas = build58mmReceiptCanvas(ticket, payoutRate);
    const bytes = canvasToEscPosRaster(canvas);
    const writer = activePort.writable.getWriter();
    try {
      const chunkSize = 512;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        await writer.write(bytes.subarray(i, Math.min(bytes.length, i + chunkSize)));
        await new Promise((r) => setTimeout(r, 15));
      }
      return { bytesSent: bytes.length };
    } finally {
      writer.releaseLock();
    }
  } catch (err) {
    activePort = null;
    throw err;
  } finally {
    isPrintingMutex = false;
  }
}
