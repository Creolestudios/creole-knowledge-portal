'use client';

import { useState, useEffect } from 'react';
import { CalendarSearch, Loader2, Calendar } from 'lucide-react';
import { PremiumMarkdownRenderer } from './PremiumMarkdownRenderer';

export default function PastBlogsTab() {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [blog, setBlog] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  
  // Basic calendar data
  const [currentDate, setCurrentDate] = useState(new Date());
  
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  
  const firstDayIndex = new Date(year, month, 1).getDay();
  const totalDays = new Date(year, month + 1, 0).getDate();
  const daysArray: (number | null)[] = [];
  
  for (let i = 0; i < firstDayIndex; i++) {
    daysArray.push(null);
  }
  for (let i = 1; i <= totalDays; i++) {
    daysArray.push(i);
  }
  
  const handleSelectDate = async (day: number) => {
    const d = new Date(year, month, day);
    const dateStr = d.toISOString().split('T')[0];
    
    // Check if it's in the future
    if (d > new Date()) return;
    
    setSelectedDate(dateStr);
    setLoading(true);
    
    try {
      const res = await fetch(`/api/digests/past?date=${dateStr}`);
      if (res.ok) {
        const data = await res.json();
        setBlog(data.blog || null);
      } else {
        setBlog(null);
      }
    } catch (e) {
      console.error(e);
      setBlog(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8 items-start">
      <div className="lg:col-span-1">
        <div className="bg-white rounded-[32px] p-6 border border-zinc-100 shadow-card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-black text-zinc-900 flex items-center gap-2">
              <Calendar size={16} className="text-brand" />
              Past Briefings
            </h3>
            <div className="flex items-center gap-1">
              <button 
                onClick={() => setCurrentDate(new Date(year, month - 1, 1))}
                className="p-1 hover:bg-zinc-50 border rounded text-zinc-600 transition-colors cursor-pointer text-[10px] font-bold"
              >
                &lt;
              </button>
              <span className="text-[10px] font-bold text-zinc-700 min-w-[70px] text-center">
                {monthNames[month]} {year}
              </span>
              <button 
                onClick={() => setCurrentDate(new Date(year, month + 1, 1))}
                className="p-1 hover:bg-zinc-50 border rounded text-zinc-600 transition-colors cursor-pointer text-[10px] font-bold"
              >
                &gt;
              </button>
            </div>
          </div>
          
          <div className="grid grid-cols-7 gap-1 text-center text-[9px] font-extrabold text-zinc-400 uppercase tracking-wider mb-2">
            <span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span>
          </div>
          
          <div className="grid grid-cols-7 gap-1">
            {daysArray.map((day, idx) => {
              let bgClass = "bg-transparent text-transparent pointer-events-none";
              let isClickable = false;
              
              if (day !== null) {
                const cellDate = new Date(year, month, day);
                const today = new Date();
                today.setHours(0,0,0,0);
                
                const dateStr = cellDate.toISOString().split('T')[0];
                const isSelected = selectedDate === dateStr;
                
                if (cellDate > today) {
                  bgClass = "bg-zinc-50 text-zinc-300 border border-zinc-100";
                } else {
                  isClickable = true;
                  bgClass = "bg-brand/10 text-brand border border-brand/20 hover:bg-brand/20 cursor-pointer";
                }
                
                if (isSelected) {
                  bgClass += " ring-2 ring-brand ring-offset-1 font-black";
                }
              }
              
              return (
                <div
                  key={idx}
                  onClick={() => isClickable && day && handleSelectDate(day)}
                  className={`aspect-square flex items-center justify-center text-[10px] font-semibold rounded transition-all duration-150 ${bgClass}`}
                >
                  {day}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="lg:col-span-2">
        {loading ? (
          <div className="flex items-center justify-center py-24 text-zinc-400 gap-3">
            <Loader2 className="animate-spin" size={20} />
            <span className="font-semibold">Loading blog...</span>
          </div>
        ) : blog ? (
          <div className="bg-white rounded-[32px] p-10 border border-zinc-100 shadow-card">
            <h2 className="text-3xl font-black text-zinc-900 tracking-tight leading-tight mb-8">
              {blog.title}
            </h2>
            <PremiumMarkdownRenderer content={blog.content} />
          </div>
        ) : (
          <div className="bg-white rounded-[32px] p-8 sm:p-16 border border-zinc-100 shadow-card text-center space-y-3">
            <CalendarSearch size={32} className="text-zinc-300 mx-auto" />
            <p className="text-zinc-500 font-semibold">
              Pick a highlighted date from the calendar to read that day's past briefing.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
