import { useState } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContract } from 'wagmi';
import { parseUnits, formatUnits } from 'viem';
import { Loader2, ArrowRight, CheckCircle, AlertCircle } from 'lucide-react';

// Constants for Arbitrum One
const HYPERLIQUID_BRIDGE_ADDRESS = '0x2df1c51E09aECF9cacB7bc98cB1742757f163dF7';
const USDC_ADDRESS = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';

// Minimal ABIs
const ERC20_ABI = [
    {
        name: 'approve',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
        outputs: [{ type: 'bool' }]
    },
    {
        name: 'allowance',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }],
        outputs: [{ type: 'uint256' }]
    },
    {
        name: 'balanceOf',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'account', type: 'address' }],
        outputs: [{ type: 'uint256' }]
    }
] as const;

const BRIDGE_ABI = [
    {
        name: 'deposit',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [{ name: 'amount', type: 'uint256' }],
        outputs: []
    }
] as const;

interface DepositModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function DepositModal({ isOpen, onClose }: DepositModalProps) {
    const { address } = useAccount();
    const [amount, setAmount] = useState('');
    const [step, setStep] = useState<'input' | 'approving' | 'depositing' | 'success'>('input');

    // Hooks for Contract Reads
    const { data: usdcBalance } = useReadContract({
        address: USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [address!],
        query: { enabled: !!address }
    });

    const { data: allowance } = useReadContract({
        address: USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [address!, HYPERLIQUID_BRIDGE_ADDRESS],
        query: { enabled: !!address }
    });

    // Write Hooks
    const { writeContract: writeApprove, data: approveHash, isPending: isApprovePending } = useWriteContract();
    const { writeContract: writeDeposit, data: depositHash, isPending: isDepositPending } = useWriteContract();

    // Transaction Wait Hooks
    const { isLoading: isWaitingApprove, isSuccess: isApproveSuccess } = useWaitForTransactionReceipt({ hash: approveHash });
    const { isLoading: isWaitingDeposit, isSuccess: isDepositSuccess } = useWaitForTransactionReceipt({ hash: depositHash });

    const handleAction = () => {
        if (!amount || parseFloat(amount) <= 0) return;
        const parsedAmount = parseUnits(amount, 6); // USDC is 6 decimals

        const currentAllowance = allowance || BigInt(0);

        if (!isApproveSuccess && currentAllowance < parsedAmount) {
            setStep('approving');
            writeApprove({
                address: USDC_ADDRESS,
                abi: ERC20_ABI,
                functionName: 'approve',
                args: [HYPERLIQUID_BRIDGE_ADDRESS, parsedAmount],
            });
        } else {
            handleDeposit();
        }
    };

    const handleDeposit = () => {
        const parsedAmount = parseUnits(amount, 6);
        setStep('depositing');
        writeDeposit({
            address: HYPERLIQUID_BRIDGE_ADDRESS,
            abi: BRIDGE_ABI,
            functionName: 'deposit',
            args: [parsedAmount],
        });
    };

    // Calculate max balance
    const balanceFormatted = usdcBalance ? formatUnits(usdcBalance, 6) : '0';

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />

            <div className="relative w-full max-w-md bg-gray-900 border border-gray-800 rounded-2xl shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                <div className="p-6">
                    <div className="flex items-center justify-between mb-6">
                        <h3 className="text-lg font-bold text-white">Deposit to Hyperliquid</h3>
                        <button onClick={onClose} className="text-gray-500 hover:text-white transition">✕</button>
                    </div>

                    {isDepositSuccess ? (
                        <div className="text-center py-8">
                            <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                                <CheckCircle className="w-8 h-8 text-emerald-500" />
                            </div>
                            <h4 className="text-xl font-bold text-white mb-2">Deposit Successful!</h4>
                            <p className="text-gray-400 text-sm mb-6">
                                Your {amount} USDC is on its way.
                            </p>
                            <button
                                onClick={onClose}
                                className="w-full py-3 bg-gray-800 hover:bg-gray-700 rounded-lg font-bold transition-colors"
                            >
                                Close
                            </button>
                        </div>
                    ) : (
                        <div className="space-y-6">
                            <p className="text-sm text-gray-400">
                                Bridge USDC from Arbitrum One to your Hyperliquid trading account.
                            </p>

                            <div className="space-y-4">
                                {/* Network Visual */}
                                <div className="flex items-center justify-between bg-gray-800/50 rounded-lg p-3 border border-gray-700">
                                    <div className="flex flex-col">
                                        <span className="text-[10px] text-gray-500 uppercase font-bold">From</span>
                                        <span className="text-sm font-bold flex items-center gap-1">
                                            <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                                            Arbitrum
                                        </span>
                                    </div>
                                    <ArrowRight className="w-4 h-4 text-gray-500" />
                                    <div className="flex flex-col text-right">
                                        <span className="text-[10px] text-gray-500 uppercase font-bold">To</span>
                                        <span className="text-sm font-bold flex items-center gap-1 justify-end">
                                            <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                                            Hyperliquid
                                        </span>
                                    </div>
                                </div>

                                {/* Input */}
                                <div className="bg-gray-800 rounded-xl p-4 border border-gray-700 focus-within:border-blue-500 transition-colors">
                                    <div className="flex justify-between items-center mb-2">
                                        <label className="text-xs text-gray-400">Amount</label>
                                        <span className="text-xs text-gray-500">
                                            Balance: <span className="text-gray-300 font-mono">{balanceFormatted} USDC</span>
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <input
                                            type="number"
                                            value={amount}
                                            onChange={(e) => {
                                                if (step === 'approving' || step === 'depositing') return;
                                                setAmount(e.target.value);
                                                if (step !== 'input') setStep('input');
                                            }}
                                            className="bg-transparent text-2xl font-bold text-white w-full focus:outline-none font-mono"
                                            placeholder="0.00"
                                            disabled={step === 'approving' || step === 'depositing'}
                                        />
                                        <button
                                            onClick={() => setAmount(balanceFormatted)}
                                            className="text-xs bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded text-blue-300 transition"
                                        >
                                            MAX
                                        </button>
                                        <span className="font-bold text-gray-400">USDC</span>
                                    </div>
                                </div>

                                {/* Action Button */}
                                <button
                                    onClick={handleAction}
                                    disabled={!amount || parseFloat(amount) <= 0 || isApprovePending || isDepositPending || isWaitingApprove || isWaitingDeposit}
                                    className={`w-full py-4 rounded-xl font-bold text-lg transition-all shadow-lg flex items-center justify-center gap-2
                                        ${step === 'input'
                                            ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-500/20'
                                            : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed'}
                                    `}
                                >
                                    {(isApprovePending || isWaitingApprove) ? (
                                        <>
                                            <Loader2 className="w-5 h-5 animate-spin" />
                                            Approving USDC...
                                        </>
                                    ) : (isDepositPending || isWaitingDeposit) ? (
                                        <>
                                            <Loader2 className="w-5 h-5 animate-spin" />
                                            Bridging funds...
                                        </>
                                    ) : step === 'approving' ? (
                                        'Approve USDC'
                                    ) : (
                                        'Deposit USDC'
                                    )}
                                </button>

                                {/* Steps Indicator */}
                                {(step !== 'input') && (
                                    <div className="flex justify-center gap-2 mt-2">
                                        <div className={`h-1.5 rounded-full w-8 transition-colors ${step === 'approving' || step === 'depositing' ? 'bg-blue-500' : 'bg-gray-700'}`} />
                                        <div className={`h-1.5 rounded-full w-8 transition-colors ${step === 'depositing' ? 'bg-blue-500' : 'bg-gray-700'}`} />
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
