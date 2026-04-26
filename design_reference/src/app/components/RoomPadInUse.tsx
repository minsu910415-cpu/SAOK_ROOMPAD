import { Clock, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';

interface TimeSlot {
  time: string;
  reserved: boolean;
  reservedBy?: string;
  blockStart?: boolean;
  blockEnd?: boolean;
  blockMiddle?: boolean;
  current?: boolean;
}

export function RoomPadInUse({ onTimeSlotClick }: { onTimeSlotClick: () => void }) {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const getCurrentTimePosition = () => {
    const hours = currentTime.getHours();
    const minutes = currentTime.getMinutes();

    if (hours < 9 || hours >= 20) return null;

    const totalMinutesFromStart = (hours - 9) * 60 + minutes;
    const totalMinutesInDay = 11 * 60;
    const percentage = (totalMinutesFromStart / totalMinutesInDay) * 100;

    return percentage;
  };

  const timePosition = getCurrentTimePosition();
  const formattedTime = currentTime.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });

  const handlePreviousDay = () => {
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() - 1);
    setSelectedDate(newDate);
  };

  const handleNextDay = () => {
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() + 1);
    setSelectedDate(newDate);
  };

  const handleToday = () => {
    setSelectedDate(new Date());
  };

  const formatDate = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
    const weekday = weekdays[date.getDay()];

    return `${year}.${month}.${day} (${weekday})`;
  };

  const isToday = selectedDate.toDateString() === new Date().toDateString();

  const timeSlots: TimeSlot[] = [
    { time: '09:00', reserved: false },
    { time: '10:00', reserved: true, reservedBy: '㈜에이비씨', blockStart: true },
    { time: '11:00', reserved: true, blockMiddle: true },
    { time: '12:00', reserved: true, reservedBy: '㈜에이비씨', blockEnd: true },
    { time: '13:00', reserved: false },
    { time: '14:00', reserved: true, reservedBy: '㈜에이비씨', blockStart: true, current: true },
    { time: '15:00', reserved: true, blockMiddle: true },
    { time: '16:00', reserved: true, blockEnd: true },
    { time: '16:30', reserved: true, reservedBy: '㈜테크솔루션', blockStart: true },
    { time: '17:00', reserved: true, blockEnd: true },
    { time: '18:00', reserved: false },
    { time: '19:00', reserved: false },
    { time: '20:00', reserved: false },
  ];

  return (
    <div className="w-full h-full bg-white flex">
      {/* Left: Timetable (40%) */}
      <div className="w-[40%] bg-[#F8FAFC] flex flex-col border-r border-gray-100">
        {/* Date Navigation */}
        <div className="p-6 pb-3">
          <div className="flex items-center justify-between mb-2">
            <button
              onClick={handlePreviousDay}
              className="p-2 hover:bg-white rounded-lg transition-colors"
            >
              <ChevronLeft size={20} className="text-[#2B3A55]" />
            </button>

            <div className="text-center">
              <div className="text-lg font-bold text-[#2B3A55]">{formatDate(selectedDate)}</div>
              {!isToday && (
                <button
                  onClick={handleToday}
                  className="text-xs text-[#F27059] hover:underline mt-1"
                >
                  오늘로 이동
                </button>
              )}
            </div>

            <button
              onClick={handleNextDay}
              className="p-2 hover:bg-white rounded-lg transition-colors"
            >
              <ChevronRight size={20} className="text-[#2B3A55]" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-8 pb-8 relative">
        <div className="space-y-0 relative">
          {timeSlots.map((slot, idx) => {
            if (slot.reserved && slot.blockMiddle) {
              return null;
            }

            let height = 'h-16';
            if (slot.reserved && slot.blockStart) {
              const nextSlots = timeSlots.slice(idx + 1);
              const blockLength = 1 + nextSlots.findIndex(s => !s.reserved || s.blockEnd);
              if (blockLength === 2) height = 'h-32';
              if (blockLength === 3) height = 'h-48';
            }

            return (
              <div
                key={slot.time}
                onClick={() => !slot.reserved && onTimeSlotClick()}
                className={`flex items-center border-b border-gray-200 ${height} transition-all relative ${!slot.reserved ? 'cursor-pointer hover:bg-white/50' : ''}`}
              >
                <div className="w-20 text-[#2B3A55] text-sm font-medium">
                  {slot.time}
                </div>
                <div className="flex-1 ml-4">
                  {slot.reserved ? (
                    <div className={`${slot.current ? 'bg-[#F27059] shadow-lg' : 'bg-gray-300'} ${slot.current ? 'text-white' : 'text-gray-500'} px-4 py-3 rounded-lg h-full flex items-center justify-center transition-all`}>
                      <span className="text-sm font-medium">{slot.reservedBy}</span>
                    </div>
                  ) : (
                    <div className="text-gray-300 text-sm">예약 가능</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Current time indicator */}
        {timePosition !== null && (
          <div
            className="absolute left-8 right-8 h-0.5 bg-[#F27059] z-10 animate-pulse"
            style={{ top: `${timePosition}%` }}
          >
            <div className="absolute -left-1 -top-1.5 w-4 h-4 bg-[#F27059] rounded-full"></div>
            <div className="absolute -right-12 -top-3 text-xs font-mono font-bold text-[#F27059] whitespace-nowrap">
              {formattedTime}
            </div>
          </div>
        )}
        </div>
      </div>

      {/* Right: Status & Action (60%) */}
      <div className="w-[60%] flex flex-col justify-center p-12">
        {/* Top: Room name & current time */}
        <div className="mb-12">
          <h1 className="text-6xl font-bold text-[#2B3A55] mb-2">STUDIO A</h1>
          <div className="flex items-center gap-2 text-2xl text-gray-400">
            <Clock size={28} />
            <span>{formattedTime}</span>
          </div>
        </div>

        {/* Center: Status */}
        <div className="text-center space-y-8">
          <div className="space-y-4">
            <div className="w-24 h-24 mx-auto rounded-full bg-[#F8FAFC] flex items-center justify-center">
              <div className="w-16 h-16 rounded-full bg-[#F27059]"></div>
            </div>
            <h2 className="text-4xl font-bold text-[#2B3A55]">현재 사용 중</h2>
          </div>
          <div className="space-y-3">
            <div className="text-gray-500 text-xl">
              예약자: <span className="text-[#2B3A55] font-medium">㈜에이비씨</span>
            </div>
            <div className="space-y-2">
              <div className="text-gray-400 text-lg">사용 시간</div>
              <div className="text-7xl font-mono font-bold text-[#F27059] tabular-nums">
                14:00 ~ 16:00
              </div>
            </div>
            <div className="text-gray-400 text-lg">
              다음 예약: <span className="text-[#2B3A55] font-medium">16:30</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
