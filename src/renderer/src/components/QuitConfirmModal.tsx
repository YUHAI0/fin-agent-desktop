import React from 'react'
import { AlertTriangle, X } from 'lucide-react'

interface QuitConfirmModalProps {
  isOpen: boolean
  onConfirm: () => void
  onCancel: () => void
}

const QuitConfirmModal: React.FC<QuitConfirmModalProps> = ({
  isOpen,
  onConfirm,
  onCancel
}) => {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in">
      <div className="bg-gray-800 rounded-2xl shadow-2xl border border-gray-700 w-full max-w-md mx-4 overflow-hidden transform transition-all animate-scale-in">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700 bg-gray-800/50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-orange-500/20 rounded-lg">
              <AlertTriangle className="w-5 h-5 text-orange-500" />
            </div>
            <h3 className="text-lg font-semibold text-white">确认退出</h3>
          </div>
          <button
            onClick={onCancel}
            className="text-gray-400 hover:text-white transition-colors p-1 rounded hover:bg-gray-700"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-5">
          <p className="text-gray-300 leading-relaxed mb-1">
            Fin-Agent 正在生成回复
          </p>
          <p className="text-gray-400 text-sm mt-3">
            是否要停止生成并退出应用？
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-700 bg-gray-800/50">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-gray-300 hover:text-white transition-colors rounded-lg hover:bg-gray-700 font-medium"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors font-medium"
          >
            继续退出
          </button>
        </div>
      </div>
    </div>
  )
}

export default QuitConfirmModal
