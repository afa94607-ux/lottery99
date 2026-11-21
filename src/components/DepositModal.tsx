import React from 'react';
import { X, Wallet, ShieldAlert, PhoneCall, Send, ArrowDownRight, ArrowUpRight, Copy, Check } from 'lucide-react';
import { formatKHR } from '../utils/formatters';
import { sound } from '../utils/audio';
import { BalanceTransaction, AppUser } from '../types/lottery';

interface DepositModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentBalance: number;
  currentUser?: AppUser | null;
  transactions?: BalanceTransaction[];
  onDeposit?: (amount: number) => void;
  onReset?: () => void;
}

export const DepositModal: React.FC<DepositModalProps> = ({
  isOpen,
  onClose,
  currentBalance,
  currentUser,
  transactions = [],
}) => {
  const [copiedText, setCopiedText] = React.useState<string | null>(null);

  if (!isOpen) return null;

  const handleCopy = (text: string, label: string) => {
    sound.playClick();
    navigator.clipboard.writeText(text);
    setCopiedText(label);
    setTimeout(() => setCopiedText(null), 2000);
  };

  const userTransactions = transactions
    .filter((t) => !currentUser || t.userId === currentUser.id)
    .slice(0, 5);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden border border-slate-200 animate-in fade-in zoom-in-95">
        {/* Header */}
        <div className="bg-[#3b6cb7] text-white px-5 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wallet className="w-5 h-5 text-amber-300" />
            <span className="font-bold text-sm sm:text-base">ព័ត៌មានកាបូបប្រាក់ (Player Account & Wallet)</span>
          </div>
          <button
            onClick={() => {
              sound.playClick();
              onClose();
            }}
            className="p-1 rounded-lg hover:bg-white/10 text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 max-h-[85vh] overflow-y-auto">
          {/* Important Admin-Only Notice Banner */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-xs text-amber-900 space-y-1">
              <div className="font-bold text-amber-950">
                ការដាក់ប្រាក់ និងដកប្រាក់ត្រូវបានគ្រប់គ្រងដោយ Admin តែប៉ុណ្ណោះ
              </div>
              <p className="text-amber-800 leading-relaxed">
                អ្នកលេងមិនអាចបញ្ចូល ឬដកប្រាក់ដោយខ្លួនឯងបានឡើយ (Players cannot deposit or withdraw directly).
                រាល់ប្រតិបត្តិការដាក់ប្រាក់ និងដកប្រាក់ ត្រូវធ្វើឡើងតាមរយៈ Owner / Admin ផ្ទាល់។
              </p>
            </div>
          </div>

          {/* Current Balance Display */}
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 text-center relative overflow-hidden">
            <div className="text-xs text-slate-500 font-medium">សមតុល្យគណនីបច្ចុប្បន្ន (Current Balance)</div>
            <div className="font-mono text-2xl sm:text-3xl font-black text-emerald-600 mt-1 tracking-tight">
              {formatKHR(currentBalance)}
            </div>
            {currentUser && (
              <div className="flex items-center justify-center gap-2 mt-2 pt-2 border-t border-slate-200/60 text-xs">
                <span className="text-slate-500">ID គណនី:</span>
                <span className="font-mono font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                  {currentUser.id}
                </span>
                <button
                  type="button"
                  onClick={() => handleCopy(currentUser.id, 'ID')}
                  className="text-slate-400 hover:text-blue-600 transition-colors p-0.5"
                  title="ចម្លង ID"
                >
                  {copiedText === 'ID' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            )}
          </div>

          {/* Contact Admin to Deposit or Withdraw */}
          <div className="bg-blue-50/70 border border-blue-200/80 rounded-xl p-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-blue-950">
                📞 ទំនាក់ទំនង Admin ដើម្បីដាក់ប្រាក់ ឬស្នើសុំដកប្រាក់:
              </span>
              <span className="text-[10px] bg-blue-200/60 text-blue-800 px-1.5 py-0.5 rounded font-semibold">
                24/7 Support
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              <div className="flex items-center justify-between bg-white p-2.5 rounded-lg border border-blue-100">
                <div className="flex items-center gap-2">
                  <Send className="w-4 h-4 text-sky-500" />
                  <div>
                    <div className="text-[10px] text-slate-400 font-medium">Telegram Admin</div>
                    <div className="font-mono font-bold text-slate-800">@SamnangLottoAdmin</div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleCopy('@SamnangLottoAdmin', 'TELEGRAM')}
                  className="p-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 text-[10px] font-medium"
                >
                  {copiedText === 'TELEGRAM' ? 'ចម្លងរួច' : 'ចម្លង'}
                </button>
              </div>

              <div className="flex items-center justify-between bg-white p-2.5 rounded-lg border border-blue-100">
                <div className="flex items-center gap-2">
                  <PhoneCall className="w-4 h-4 text-emerald-500" />
                  <div>
                    <div className="text-[10px] text-slate-400 font-medium">Hotline ទូរស័ព្ទ</div>
                    <div className="font-mono font-bold text-slate-800">012 999 888</div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleCopy('012999888', 'PHONE')}
                  className="p-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 text-[10px] font-medium"
                >
                  {copiedText === 'PHONE' ? 'ចម្លងរួច' : 'ចម្លង'}
                </button>
              </div>
            </div>

            <p className="text-[11px] text-slate-500">
              💡 ជំហាន៖ ផ្ញើ ID គណនីរបស់អ្នកទៅកាន់ Admin រួមជាមួយវិក្កយបត្រវេលុយ (ABA / Wing) ដើម្បីបញ្ចូលទឹកប្រាក់ភ្លាមៗ។
            </p>
          </div>

          {/* Recent Deposit / Withdrawal History for this player */}
          {userTransactions.length > 0 && (
            <div className="space-y-2 pt-1">
              <span className="text-xs font-bold text-slate-700 block">
                ប្រវត្តិដាក់-ដកប្រាក់ចុងក្រោយ (Transactions by Admin):
              </span>
              <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                {userTransactions.map((tx) => (
                  <div
                    key={tx.transactionId}
                    className="p-2 bg-slate-50 rounded-lg border border-slate-200/80 flex items-center justify-between text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-[10px] ${
                          tx.type === 'DEPOSIT'
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-rose-100 text-rose-700'
                        }`}
                      >
                        {tx.type === 'DEPOSIT' ? (
                          <ArrowDownRight className="w-3.5 h-3.5" />
                        ) : (
                          <ArrowUpRight className="w-3.5 h-3.5" />
                        )}
                      </span>
                      <div>
                        <div className="font-semibold text-slate-800">
                          {tx.type === 'DEPOSIT' ? 'Admin ដាក់ប្រាក់' : 'Admin ដកប្រាក់'}
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono">
                          {tx.createdAt} • {tx.paymentMethod}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div
                        className={`font-mono font-bold ${
                          tx.type === 'DEPOSIT' ? 'text-emerald-600' : 'text-rose-600'
                        }`}
                      >
                        {tx.type === 'DEPOSIT' ? '+' : '-'}
                        {formatKHR(tx.amount)}
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono">
                        សមតុល្យ: {formatKHR(tx.newBalance)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Close button */}
          <div className="pt-2 border-t border-slate-100">
            <button
              onClick={() => {
                sound.playClick();
                onClose();
              }}
              className="w-full py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition-colors flex items-center justify-center"
            >
              បិទផ្ទាំង (Close)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
