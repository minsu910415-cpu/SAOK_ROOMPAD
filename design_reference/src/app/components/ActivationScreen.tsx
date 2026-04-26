import { useState } from 'react';
import { Delete, Loader2 } from 'lucide-react';

export function ActivationScreen({ onActivated }: { onActivated: () => void }) {
  const [pinCode, setPinCode] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const PIN_LENGTH = 6;

  const handleNumberClick = (num: string) => {
    if (pinCode.length < PIN_LENGTH) {
      const newPin = pinCode + num;
      setPinCode(newPin);

      // Auto-submit when 6 digits are entered
      if (newPin.length === PIN_LENGTH) {
        setIsConnecting(true);
        setTimeout(() => {
          // Simulate validation
          if (newPin === '123456') {
            setTimeout(() => {
              onActivated();
            }, 1500);
          } else {
            setIsConnecting(false);
            alert('올바른 PIN 코드가 아닙니다.');
            setPinCode('');
          }
        }, 300);
      }
    }
  };

  const handleDelete = () => {
    setPinCode(prev => prev.slice(0, -1));
  };

  // Show loading screen when connecting
  if (isConnecting) {
    return (
      <div className="w-full h-full bg-[#F8FAFC] flex items-center justify-center">
        <div className="bg-white rounded-3xl shadow-2xl p-12 w-[800px] h-[550px] flex flex-col items-center justify-center">
          <div className="mb-8">
            <Loader2 size={100} className="text-[#F27059] animate-spin" strokeWidth={2} />
          </div>
          <h2 className="text-4xl font-bold text-[#2B3A55] mb-3">연결 중...</h2>
          <p className="text-xl text-gray-500">기기를 활성화하고 있습니다.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full bg-[#F8FAFC] flex items-center justify-center">
      <div className="bg-white rounded-3xl shadow-2xl p-10 w-[850px] max-h-[750px] flex flex-col items-center">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-[#2B3A55] mb-4">SAOK</h1>
          <p className="text-xl text-[#2B3A55] leading-relaxed">
            기기 활성화를 위한<br />6자리 PIN 코드를 입력해 주세요.
          </p>
        </div>

        {/* PIN Input Fields */}
        <div className="flex gap-3 mb-8">
          {Array.from({ length: PIN_LENGTH }).map((_, index) => (
            <div
              key={index}
              className="w-16 h-20 border-2 border-gray-200 rounded-xl flex items-center justify-center bg-white"
            >
              <span className="text-4xl font-bold text-[#2B3A55]">
                {pinCode[index] ? '●' : ''}
              </span>
            </div>
          ))}
        </div>

        {/* Numeric Keypad */}
        <div className="grid grid-cols-3 gap-3 w-full max-w-[480px] mb-6">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((num) => (
            <button
              key={num}
              onClick={() => handleNumberClick(num)}
              className="bg-white border-2 border-gray-200 hover:border-[#2B3A55] hover:bg-[#F8FAFC] rounded-2xl h-[70px] text-3xl font-bold text-[#2B3A55] transition-all active:scale-95 shadow-sm"
            >
              {num}
            </button>
          ))}
          <button
            onClick={handleDelete}
            className="bg-white border-2 border-gray-200 hover:border-[#2B3A55] hover:bg-[#F8FAFC] rounded-2xl h-[70px] text-3xl font-bold text-[#2B3A55] transition-all active:scale-95 shadow-sm flex items-center justify-center"
          >
            <Delete size={32} />
          </button>
          <button
            onClick={() => handleNumberClick('0')}
            className="bg-white border-2 border-gray-200 hover:border-[#2B3A55] hover:bg-[#F8FAFC] rounded-2xl h-[70px] text-3xl font-bold text-[#2B3A55] transition-all active:scale-95 shadow-sm"
          >
            0
          </button>
          <div></div>
        </div>

        {/* Helper text */}
        <p className="text-gray-400 text-sm">
          PIN 코드는 관리자로부터 받으실 수 있습니다.
        </p>
      </div>
    </div>
  );
}
