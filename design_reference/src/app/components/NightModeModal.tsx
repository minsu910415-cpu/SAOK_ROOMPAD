import { X, AlertTriangle } from 'lucide-react';
import { useState } from 'react';

export function NightModeModal({ onClose, onDisconnect }: { onClose: () => void; onDisconnect: () => void }) {
  const [isEnabled, setIsEnabled] = useState(true);
  const [startTime, setStartTime] = useState('22:00');
  const [endTime, setEndTime] = useState('08:00');
  const [wakeOnTouch, setWakeOnTouch] = useState(true);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);

  const timeSlots = [
    '00:00', '01:00', '02:00', '03:00', '04:00', '05:00',
    '06:00', '07:00', '08:00', '09:00', '10:00', '11:00',
    '12:00', '13:00', '14:00', '15:00', '16:00', '17:00',
    '18:00', '19:00', '20:00', '21:00', '22:00', '23:00'
  ];

  const handleSave = () => {
    alert('설정이 저장되었습니다.');
    onClose();
  };

  const handleDisconnectConfirm = () => {
    setShowDisconnectConfirm(false);
    onDisconnect();
    onClose();
  };

  return (
    <>
    <div className="fixed inset-0 bg-white/90 backdrop-blur-md flex items-center justify-center z-50">
      <div className="bg-white rounded-3xl shadow-2xl p-12 w-[950px] max-h-[90vh] overflow-y-auto max-w-[90vw] relative flex flex-col">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-6 right-6 text-gray-400 hover:text-[#2B3A55] transition-colors"
        >
          <X size={32} />
        </button>

        {/* Header */}
        <div className="mb-10">
          <h2 className="text-4xl font-bold text-[#2B3A55]">룸패드 설정</h2>
        </div>

        {/* Section 1: Night Mode */}
        <div className="mb-10">
          <h3 className="text-2xl font-bold text-[#2B3A55] mb-6">야간 절전 설정</h3>

        {/* Main Toggle */}
        <div className="mb-6">
          <div className="flex items-center justify-between bg-[#F8FAFC] rounded-2xl p-6">
            <span className="text-2xl font-medium text-[#2B3A55]">야간 절전 모드 활성화</span>
            <button
              onClick={() => setIsEnabled(!isEnabled)}
              className={`relative w-20 h-10 rounded-full transition-colors ${
                isEnabled ? 'bg-[#F27059]' : 'bg-gray-300'
              }`}
            >
              <div
                className={`absolute top-1 w-8 h-8 bg-white rounded-full shadow-md transition-transform ${
                  isEnabled ? 'translate-x-11' : 'translate-x-1'
                }`}
              ></div>
            </button>
          </div>

          {/* Helper Text */}
          <p className="mt-4 text-gray-400 text-base leading-relaxed px-2">
            기기 화면을 물리적으로 끄지 않고, 앱을 검은 화면으로 전환한 뒤 밝기를 0%로 낮춰 권한 충돌 없이 화면을 보호합니다.
          </p>
        </div>

        {/* Time Settings */}
        <div className="space-y-6">
          <div className="flex gap-8">
            <div className="flex-1">
              <label className="block text-lg text-gray-600 mb-3">시작 시간</label>
              <select
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                disabled={!isEnabled}
                className={`w-full px-6 py-5 rounded-xl border border-gray-200 text-[#2B3A55] font-medium text-2xl focus:border-[#F27059] focus:outline-none transition-colors ${
                  !isEnabled ? 'bg-gray-100 text-gray-400' : ''
                }`}
              >
                {timeSlots.map((time) => (
                  <option key={time} value={time}>{time}</option>
                ))}
              </select>
            </div>

            <div className="flex-1">
              <label className="block text-lg text-gray-600 mb-3">종료 시간</label>
              <select
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                disabled={!isEnabled}
                className={`w-full px-6 py-5 rounded-xl border border-gray-200 text-[#2B3A55] font-medium text-2xl focus:border-[#F27059] focus:outline-none transition-colors ${
                  !isEnabled ? 'bg-gray-100 text-gray-400' : ''
                }`}
              >
                {timeSlots.map((time) => (
                  <option key={time} value={time}>{time}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Wake-up Option */}
          <div className="flex items-center gap-4 bg-[#F8FAFC] rounded-2xl p-6">
            <input
              type="checkbox"
              id="wakeOnTouch"
              checked={wakeOnTouch}
              onChange={(e) => setWakeOnTouch(e.target.checked)}
              disabled={!isEnabled}
              className="w-7 h-7 rounded border-2 border-gray-300 text-[#F27059] focus:ring-[#F27059] focus:ring-2 cursor-pointer disabled:bg-gray-100"
            />
            <label
              htmlFor="wakeOnTouch"
              className={`text-xl font-medium cursor-pointer ${
                !isEnabled ? 'text-gray-400' : 'text-[#2B3A55]'
              }`}
            >
              화면 터치 시 즉시 깨우기 (Wake-up)
            </label>
          </div>
        </div>
        </div>

        {/* Divider */}
        <div className="h-px bg-gray-200 mb-10"></div>

        {/* Section 2: Device Info & Management */}
        <div className="mb-10">
          <h3 className="text-2xl font-bold text-[#2B3A55] mb-6">기기 정보</h3>

          <div className="bg-[#F8FAFC] rounded-2xl p-6 mb-6">
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-gray-600 text-lg">연결된 공간</span>
                <span className="text-[#2B3A55] text-xl font-bold">STUDIO A</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-600 text-lg">모델명</span>
                <span className="text-[#2B3A55] text-lg">Galaxy Tab A7</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-600 text-lg">기기 ID</span>
                <span className="text-[#2B3A55] text-lg font-mono">SAOK-2024-0001</span>
              </div>
            </div>
          </div>

          {/* Disconnect Button */}
          <div className="space-y-3">
            <button
              onClick={() => setShowDisconnectConfirm(true)}
              className="w-full px-6 py-5 rounded-2xl border-2 border-red-400 bg-white text-red-500 text-xl font-bold hover:bg-red-50 transition-all active:scale-95"
            >
              기기 연결 해지
            </button>
            <p className="text-gray-400 text-sm text-center leading-relaxed px-4">
              기기 변경을 위해 현재 연결된 공간과의 매칭을 해제합니다.
            </p>
          </div>
        </div>

        {/* Save Button */}
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={!isEnabled}
            className={`px-16 py-6 rounded-2xl text-2xl font-bold transition-all ${
              isEnabled
                ? 'bg-[#2B3A55] hover:bg-[#1f2a3f] text-white shadow-lg hover:shadow-xl active:scale-95'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }`}
          >
            저장하기
          </button>
        </div>
      </div>
    </div>

    {/* Disconnect Confirmation Modal */}
    {showDisconnectConfirm && (
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[60]">
        <div className="bg-white rounded-3xl shadow-2xl p-12 w-[750px] max-w-[90vw] relative text-center">
          {/* Warning Icon */}
          <div className="w-24 h-24 mx-auto mb-8 rounded-full bg-red-50 flex items-center justify-center">
            <div className="w-20 h-20 rounded-full bg-red-100 flex items-center justify-center">
              <AlertTriangle size={48} className="text-red-500" strokeWidth={2.5} />
            </div>
          </div>

          {/* Title */}
          <h2 className="text-4xl font-bold text-[#2B3A55] mb-6">
            정말로 기기 연결을<br />해지하시겠습니까?
          </h2>

          {/* Description */}
          <p className="text-xl text-gray-600 leading-relaxed mb-10">
            연결 해지 시 현재 공간 정보와의 연결이 끊기며,<br />
            다시 사용하려면 활성 PIN 코드를 재입력해야 합니다.
          </p>

          {/* Action Buttons */}
          <div className="flex gap-5">
            <button
              onClick={() => setShowDisconnectConfirm(false)}
              className="flex-1 py-6 rounded-2xl text-2xl font-bold bg-gray-100 text-gray-600 hover:bg-gray-200 transition-all active:scale-95"
            >
              취소
            </button>
            <button
              onClick={handleDisconnectConfirm}
              className="flex-1 py-6 rounded-2xl text-2xl font-bold bg-red-500 hover:bg-red-600 text-white shadow-lg hover:shadow-xl transition-all active:scale-95"
            >
              확인 및 연결 해지
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
