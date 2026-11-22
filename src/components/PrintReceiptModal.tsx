import React, { useEffect, useRef, useState } from 'react';
import { Printer, X, CheckCircle2, Bluetooth } from 'lucide-react';
import { BetTicket } from '../types/lottery';
import { formatKHR, LOTTERY_PAYOUT_RATE } from '../utils/formatters';
import {
  connectWebBluetoothPrinter,
  disconnectWebBluetoothPrinter,
  getRememberedWebPrinter,
  isWebSerialSupported,
  printTicketViaWebSerial,
  selectNewWebBluetoothPrinter,
  WebPrinterStatus,
} from '../utils/webThermalPrinter';

interface PrintReceiptModalProps {
  isOpen: boolean;
  onClose: () => void;
  ticket: BetTicket | null;
  payoutRate?: number;
}

export const PrintReceiptModal: React.FC<PrintReceiptModalProps> = ({
  isOpen,
  onClose,
  ticket,
  payoutRate = LOTTERY_PAYOUT_RATE,
}) => {
  const [webPrinter, setWebPrinter] = useState<WebPrinterStatus>(() => ({
    supported: isWebSerialSupported(),
    state: 'disconnected',
    deviceLabel: '',
  }));
  const [statusMsg, setStatusMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [isPrinting, setIsPrinting] = useState(false);
  const printingRef = useRef(false);

  useEffect(() => {
    if (!isOpen) return;
    setStatusMsg(null);
    void getRememberedWebPrinter().then(setWebPrinter);
  }, [isOpen]);

  if (!isOpen || !ticket) return null;

  const isPreview = !ticket.ticketId || ticket.ticketId.startsWith('PREVIEW-');

  const handleSystemPrint = () => {
    if (printingRef.current) return;
    printingRef.current = true;
    setIsPrinting(true);
    try {
      window.print();
    } finally {
      window.setTimeout(() => {
        printingRef.current = false;
        setIsPrinting(false);
      }, 900);
    }
  };

  const handleWebConnect = async (pickNew = false) => {
    setStatusMsg(null);
    setWebPrinter((prev) => ({ ...prev, state: 'connecting', error: undefined }));
    const next = pickNew
      ? await selectNewWebBluetoothPrinter()
      : await connectWebBluetoothPrinter();
    setWebPrinter(next);
    if (next.state === 'error' && next.error) {
      setStatusMsg({ type: 'err', text: next.error });
    } else if (next.state === 'connected') {
      setStatusMsg({ type: 'ok', text: `Connected: ${next.deviceLabel}` });
    }
  };

  const handleWebDisconnect = async () => {
    const next = await disconnectWebBluetoothPrinter();
    setWebPrinter(next);
    setStatusMsg({ type: 'ok', text: 'Printer disconnected.' });
  };

  const handleWebBluetoothPrint = async () => {
    if (printingRef.current) return;
    setStatusMsg(null);
    if (isPreview) {
      setStatusMsg({
        type: 'err',
        text: 'Preview only — please confirm your bet first before printing an official receipt.',
      });
      return;
    }
    printingRef.current = true;
    setIsPrinting(true);
    setWebPrinter((prev) => ({ ...prev, state: 'printing', error: undefined }));
    try {
      const res = await printTicketViaWebSerial(ticket, payoutRate);
      setWebPrinter((prev) => ({ ...prev, state: 'connected' }));
      setStatusMsg({
        type: 'ok',
        text: `Receipt sent to printer (${res.bytesSent} bytes). Check paper output.`,
      });
    } catch (e) {
      const errText = e instanceof Error ? e.message : 'Bluetooth print failed.';
      setWebPrinter((prev) => ({ ...prev, state: 'disconnected', error: errText }));
      setStatusMsg({ type: 'err', text: errText });
    } finally {
      printingRef.current = false;
      setIsPrinting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full overflow-hidden border border-slate-200 max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="bg-[#3b6cb7] text-white px-4 py-3 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Printer className="w-4 h-4 text-amber-300" />
            <span className="font-bold text-sm">វិក្កយបត្រឆ្នោត (Bet Receipt)</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-white/10 text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Receipt Paper Area */}
        <div id="printable-receipt" className="p-5 bg-[#fffdf9] font-mono text-slate-800 text-xs overflow-y-auto">
          {/* Header */}
          <div className="text-center pb-3 border-b-2 border-dashed border-slate-300">
            <h2 className="text-lg font-black tracking-wider text-slate-900 font-sans">ឆ្នោតសំណាង 1/99</h2>
            <p
              className={`text-[11px] font-bold font-sans ${
                isPreview ? 'text-amber-700' : 'text-slate-600'
              }`}
            >
              {isPreview
                ? 'PREVIEW ONLY — NOT AN OFFICIAL BET'
                : 'វិក្កយបត្រផ្លូវការ / OFFICIAL LOTTERY RECEIPT'}
            </p>
            <p className="text-[10px] text-slate-500 mt-1">កាលបរិច្ឆេទ: {ticket.createdAt}</p>
          </div>

          {/* Ticket Metadata */}
          <div className="py-3 border-b border-dashed border-slate-300 space-y-1">
            <div className="flex justify-between">
              <span className="text-slate-500">លេខកូដសំបុត្រ:</span>
              <span className="font-bold">{ticket.ticketId}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">វេនចាប់រង្វាន់:</span>
              <span className="font-bold text-blue-700">{ticket.roundId}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">ប៉ុស្តិ៍ភ្នាល់:</span>
              <span className="font-bold">{ticket.channels.join(', ')}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">ចំនួនលេខ:</span>
              <span>{ticket.numbers.length} លេខ</span>
            </div>
          </div>

          {/* Numbers list */}
          <div className="py-3 border-b border-dashed border-slate-300">
            <span className="text-slate-500 block mb-1.5 font-sans">បញ្ជីលេខដែលបានចាក់:</span>
            <div className="flex flex-wrap gap-1.5">
              {ticket.numbers.map((n) => (
                <span
                  key={n}
                  className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 font-bold text-slate-900 text-xs"
                >
                  {n}
                </span>
              ))}
            </div>
          </div>

          {/* Pricing & Stake Calculation */}
          <div className="py-3 border-b-2 border-dashed border-slate-300 space-y-1.5">
            <div className="flex justify-between">
              <span className="text-slate-500">តម្លៃក្នុង 1 លេខ:</span>
              <span>{formatKHR(ticket.stakePerUnit)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">សរុបភ្នាល់:</span>
              <span>{ticket.totalBetsCount} ភ្នាល់</span>
            </div>
            <div className="flex justify-between text-sm font-bold pt-1 border-t border-slate-200">
              <span>សរុបទឹកប្រាក់:</span>
              <span className="text-blue-700">{formatKHR(ticket.totalCost)}</span>
            </div>
            <div className="flex justify-between text-[11px] text-emerald-700 font-medium">
              <span>រង្វាន់ឈ្នះក្នុង 1 ប៉ុស្តិ៍ (1:{payoutRate}):</span>
              <span>{formatKHR(ticket.stakePerUnit * payoutRate)}</span>
            </div>
          </div>

          {/* Status badge if already drawn */}
          {!isPreview && ticket.status !== 'PENDING' && (
            <div className="py-2.5 text-center border-b border-dashed border-slate-300">
              {ticket.status === 'WON' ? (
                <div className="text-emerald-700 font-bold flex items-center justify-center gap-1">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>បានឈ្នះ: {formatKHR(ticket.wonAmount)}</span>
                </div>
              ) : (
                <div className="text-slate-500 font-semibold">មិនត្រូវរង្វាន់</div>
              )}
            </div>
          )}

          {/* Barcode */}
          <div className="pt-4 flex flex-col items-center">
            <div className="h-10 w-44 flex items-center justify-between overflow-hidden bg-white p-1 border border-slate-200">
              {Array.from({ length: 34 }).map((_, i) => (
                <div
                  key={i}
                  className={`h-full ${i % 3 === 0 ? 'w-1 bg-black' : i % 2 === 0 ? 'w-0.5 bg-black' : 'w-1.5 bg-slate-800'}`}
                />
              ))}
            </div>
            <span className="text-[10px] text-slate-500 mt-1 tracking-widest">{ticket.ticketId}*199</span>
            <p className="text-[10px] text-slate-400 mt-2 font-sans text-center">
              {isPreview
                ? 'សម្រាប់ពិនិត្យប៉ុណ្ណោះ — មិនទាន់បានភ្នាល់នៅឡើយ'
                : 'សូមរក្សាទុកសំបុត្រនេះដើម្បីបើករង្វាន់។ អរគុណ និងសំណាងល្អ!'}
            </p>
          </div>
        </div>

        {/* Web Serial Bluetooth Status Bar (Chrome / Desktop / Supported Android Chrome) */}
        <div className="px-4 py-2 bg-slate-50 border-t border-slate-200 text-[11px] space-y-1.5 shrink-0">
          {webPrinter.supported ? (
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-600 font-semibold truncate">
                {webPrinter.state === 'connected'
                  ? `Printer: ${webPrinter.deviceLabel}`
                  : webPrinter.state === 'printing'
                  ? 'Status: Printing...'
                  : webPrinter.state === 'connecting'
                  ? 'Status: Connecting...'
                  : webPrinter.deviceLabel || 'Bluetooth Printer: Disconnected'}
              </span>
              <div className="flex items-center gap-1.5 shrink-0">
                {webPrinter.state === 'connected' ? (
                  <button
                    onClick={() => void handleWebDisconnect()}
                    className="px-2 py-0.5 rounded bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold"
                  >
                    Disconnect
                  </button>
                ) : (
                  <button
                    onClick={() => void handleWebConnect(true)}
                    disabled={webPrinter.state === 'connecting'}
                    className="px-2 py-0.5 rounded bg-blue-100 hover:bg-blue-200 text-blue-700 font-semibold"
                  >
                    Connect Printer
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="text-slate-500">
              Direct browser Bluetooth unavailable here; tap Print to use Android Print Service.
            </div>
          )}

          {statusMsg && (
            <div
              className={`font-semibold px-2.5 py-1.5 rounded border ${
                statusMsg.type === 'ok'
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-rose-50 text-rose-700 border-rose-200'
              }`}
            >
              {statusMsg.text}
            </div>
          )}
        </div>

        {/* Modal Actions */}
        <div className="bg-slate-50 px-4 py-3 flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 shrink-0">
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-200 transition-colors"
          >
            បិទ (Close)
          </button>
          {webPrinter.supported && (
            <button
              onClick={() => void handleWebBluetoothPrint()}
              disabled={isPrinting}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold bg-[#3b6cb7] hover:bg-blue-700 disabled:opacity-50 text-white shadow-sm transition-transform active:scale-95"
            >
              <Bluetooth className="w-3.5 h-3.5" />
              <span>{isPrinting ? 'Printing...' : 'Bluetooth Print'}</span>
            </button>
          )}
          <button
            onClick={handleSystemPrint}
            disabled={isPrinting}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold bg-[#22c55e] hover:bg-emerald-600 disabled:opacity-50 text-white shadow-sm transition-transform active:scale-95"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>{isPrinting ? 'Printing...' : 'បោះពុម្ពឥឡូវ (Print)'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
