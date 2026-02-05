import CSVUpload from '@/components/CSVUpload';

interface ImportModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess?: () => void;
}

export default function ImportModal({ isOpen, onClose, onSuccess }: ImportModalProps) {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4" onClick={onClose}>
            <div className="w-full max-w-md animate-in zoom-in-95 duration-300" onClick={e => e.stopPropagation()}>
                <CSVUpload onUploadComplete={() => {
                    if (onSuccess) onSuccess();
                    onClose();
                }} />
            </div>
        </div>
    );
}
