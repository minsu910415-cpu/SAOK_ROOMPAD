import { useState } from 'react';
import { X, Delete, Check, ChevronLeft, Clock } from 'lucide-react';

type ModalStep = 'phone' | 'confirm' | 'success';

export function ReservationModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<ModalStep>('phone');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [startTime, setStartTime] = useState('14:00');
  const [endTime, setEndTime] = useState('16:00');

  const timeSlots = [
    '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
    '12:00', '12:30', '13:00', '13:30', '14:00', '14:30',
    '15:00', '15:30', '16:00', '16:30', '17:00', '17:30',
    '18:00', '18:30', '19:00', '19:30', '20:00'
  ];

  const handleNumberClick = (num: string) => {
    if (phoneNumber.length < 11) {
      setPhoneNumber(prev => prev + num);
    }
  };

  const handleDelete = () => {
    setPhoneNumber(prev => prev.slice(0, -1));
  };

  const handleNextStep = () => {
    if (phoneNumber.length >= 10) {
      setStep('confirm');
    }
  };

  const handleConfirmReservation = () => {
    setStep('success');
    setTimeout(() => {
      onClose();
    }, 3000);
  };

  const handleBack = () => {
    if (step === 'confirm') {
      setStep('phone');
    } else {
      onClose();
    }
  };

  const formatPhoneNumberMasked = (num: string) => {
    if (num.length < 7) {
      return num;
    }
    const part1 = num.slice(0, 3);
    const part2 = '****';
    const part3 = num.slice(7);
    return `${part1} - ${part2} - ${part3}`;
  };

  const calculateDuration = () => {
    const start = timeSlots.indexOf(startTime);
    const end = timeSlots.indexOf(endTime);
    if (end <= start) return 0;
    const diff = (end - start) * 0.5;
    return diff;
  };

  if (step === 'phone') {
    return (
      <div className="fixed inset-0 bg-white/90 backdrop-blur-md flex items-center justify-center z-50">
        <div className="bg-white rounded-3xl shadow-2xl p-10 w-[1050px] h-[680px] max-w-[90vw] max-h-[90vh] relative flex flex-col">
          <button
            onClick={handleBack}
            className="absolute top-6 left-6 text-gray-400 hover:text-[#2B3A55] transition-colors"
            title="뒤로가기"
          >
            <ChevronLeft size={32} />
          </button>

          <button
            onClick={onClose}
            className="absolute top-6 right-6 text-gray-400 hover:text-[#2B3A55] transition-colors"
          >
            <X size={32} />
          </button>

          <div className="text-center mb-6">
            <h2 className="text-3xl font-bold text-[#2B3A55] mb-2">예약자 확인을 위해</h2>
            <p className="text-xl text-[#2B3A55]">휴대폰 번호를 입력해 주세요</p>
          </div>

          <div className="flex-1 flex gap-6">
            {/* Left: Time Selection */}
            <div className="w-[35%] bg-[#F8FAFC] rounded-2xl p-6 flex flex-col">
              <div className="flex items-center gap-2 mb-5">
                <Clock size={24} className="text-[#2B3A55]" />
                <h3 className="text-xl font-bold text-[#2B3A55]">예약 시간 설정</h3>
              </div>

              <div className="space-y-4 flex-1">
                <div>
                  <label className="block text-base text-gray-600 mb-2">시작 시간</label>
                  <select
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="w-full px-4 py-4 rounded-xl border-2 border-gray-200 text-[#2B3A55] font-bold text-xl focus:border-[#F27059] focus:outline-none transition-colors"
                  >
                    {timeSlots.map((time) => (
                      <option key={time} value={time}>{time}</option>
                    ))}
                  </select>
                </div>

                <div className="text-3xl text-gray-400 text-center">~</div>

                <div>
                  <label className="block text-base text-gray-600 mb-2">종료 시간</label>
                  <select
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="w-full px-4 py-4 rounded-xl border-2 border-gray-200 text-[#2B3A55] font-bold text-xl focus:border-[#F27059] focus:outline-none transition-colors"
                  >
                    {timeSlots.map((time) => (
                      <option key={time} value={time}>{time}</option>
                    ))}
                  </select>
                </div>

                {calculateDuration() > 0 && (
                  <div className="mt-auto bg-white rounded-xl p-4 text-center">
                    <span className="text-[#F27059] font-bold text-2xl">
                      총 {calculateDuration()}시간
                    </span>
                  </div>
                )}
                {calculateDuration() <= 0 && (
                  <div className="mt-auto bg-red-50 rounded-xl p-4 text-center">
                    <span className="text-red-500 text-base">
                      종료 시간은 시작 시간보다 늦어야 합니다
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Right: Phone Input */}
            <div className="flex-1 flex flex-col">
              <div className="bg-[#F8FAFC] rounded-2xl p-6 mb-5 text-center">
                <div className="text-4xl font-mono font-bold text-[#2B3A55] h-14 flex items-center justify-center tabular-nums tracking-wider">
                  {phoneNumber.length >= 7 ? formatPhoneNumberMasked(phoneNumber) : (phoneNumber || '010 - **** - 5678')}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 mb-5">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((num) => (
                  <button
                    key={num}
                    onClick={() => handleNumberClick(num)}
                    className="bg-white border-2 border-gray-200 hover:border-[#F27059] hover:bg-[#F8FAFC] rounded-2xl h-[70px] text-3xl font-bold text-[#2B3A55] transition-all active:scale-95 shadow-sm"
                  >
                    {num}
                  </button>
                ))}
                <button
                  onClick={handleDelete}
                  className="bg-white border-2 border-gray-200 hover:border-[#F27059] hover:bg-[#F8FAFC] rounded-2xl h-[70px] text-3xl font-bold text-[#2B3A55] transition-all active:scale-95 shadow-sm flex items-center justify-center"
                >
                  <Delete size={36} />
                </button>
                <button
                  onClick={() => handleNumberClick('0')}
                  className="bg-white border-2 border-gray-200 hover:border-[#F27059] hover:bg-[#F8FAFC] rounded-2xl h-[70px] text-3xl font-bold text-[#2B3A55] transition-all active:scale-95 shadow-sm"
                >
                  0
                </button>
                <div></div>
              </div>

              <button
                onClick={handleNextStep}
                disabled={phoneNumber.length < 10 || calculateDuration() <= 0}
                className={`w-full py-6 rounded-2xl text-2xl font-bold transition-all ${
                  phoneNumber.length >= 10 && calculateDuration() > 0
                    ? 'bg-[#F27059] hover:bg-[#e65f47] text-white shadow-lg hover:shadow-xl active:scale-95'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                }`}
              >
                다음 단계
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'confirm') {
    return (
      <div className="fixed inset-0 bg-white/90 backdrop-blur-md flex items-center justify-center z-50">
        <div className="bg-white rounded-3xl shadow-2xl p-10 w-[950px] h-[650px] max-w-[90vw] max-h-[90vh] relative flex flex-col">
          <button
            onClick={handleBack}
            className="absolute top-6 left-6 text-gray-400 hover:text-[#2B3A55] transition-colors"
            title="뒤로가기"
          >
            <ChevronLeft size={32} />
          </button>

          <button
            onClick={onClose}
            className="absolute top-6 right-6 text-gray-400 hover:text-[#2B3A55] transition-colors"
          >
            <X size={32} />
          </button>

          <div className="mb-6">
            <h2 className="text-4xl font-bold text-[#2B3A55] mb-2">101호 ㈜테크솔루션 (김대표)</h2>
            <p className="text-gray-500 text-xl">예약 정보를 확인해 주세요</p>
          </div>

          <div className="flex-1 bg-[#F8FAFC] rounded-2xl p-8 mb-6 space-y-6">
            <div className="flex justify-between items-center pb-4 border-b-2 border-gray-200">
              <span className="text-gray-600 text-2xl">예약 공간</span>
              <span className="text-[#2B3A55] text-2xl font-bold">STUDIO A</span>
            </div>
            <div className="flex justify-between items-center pb-4 border-b-2 border-gray-200">
              <span className="text-gray-600 text-2xl">예약 시간</span>
              <span className="text-[#2B3A55] text-2xl font-bold">{startTime} ~ {endTime} ({calculateDuration()}시간)</span>
            </div>

            <div className="pt-4 space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-gray-600 text-xl">보유 코인</span>
                <span className="text-[#2B3A55] text-2xl font-bold">50 C</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[#F27059] text-xl font-medium">차감 코인</span>
                <span className="text-[#F27059] text-2xl font-bold">- {calculateDuration() * 10} C</span>
              </div>
              <div className="h-0.5 bg-gray-300"></div>
              <div className="flex justify-between items-center">
                <span className="text-[#2B3A55] text-2xl font-bold">잔여 코인</span>
                <span className="text-[#2B3A55] text-3xl font-bold">{50 - (calculateDuration() * 10)} C</span>
              </div>
            </div>
          </div>

          <div className="flex gap-5">
            <button
              onClick={onClose}
              className="flex-1 py-6 rounded-2xl text-2xl font-bold bg-white border-2 border-gray-300 text-gray-600 hover:bg-gray-50 transition-all active:scale-95"
            >
              취소
            </button>
            <button
              onClick={handleConfirmReservation}
              className="flex-[2] py-6 rounded-2xl text-2xl font-bold bg-[#F27059] hover:bg-[#e65f47] text-white shadow-lg hover:shadow-xl transition-all active:scale-95"
            >
              결제 및 예약 확정
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'success') {
    return (
      <div className="fixed inset-0 bg-white/90 backdrop-blur-md flex items-center justify-center z-50">
        <div className="bg-white rounded-3xl shadow-2xl p-16 w-[850px] h-[560px] max-w-[90vw] max-h-[90vh] relative text-center flex flex-col justify-center">
          <div className="mb-14">
            <div className="w-40 h-40 mx-auto mb-10 rounded-full bg-green-50 flex items-center justify-center">
              <div className="w-32 h-32 rounded-full bg-green-100 flex items-center justify-center">
                <Check size={80} className="text-green-600" strokeWidth={3} />
              </div>
            </div>
            <h2 className="text-5xl font-bold text-[#2B3A55] mb-5">예약이 완료되었습니다.</h2>
            <p className="text-2xl text-gray-500 leading-relaxed">STUDIO A의 문이 열렸습니다.<br />바로 이용해 주세요.</p>
          </div>

          <button
            onClick={onClose}
            className="w-full py-7 rounded-2xl text-3xl font-bold bg-[#2B3A55] hover:bg-[#1f2a3f] text-white shadow-lg hover:shadow-xl transition-all active:scale-95"
          >
            확인
          </button>
        </div>
      </div>
    );
  }

  return null;
}
