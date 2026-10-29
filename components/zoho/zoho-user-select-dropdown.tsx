'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Users, ChevronDown, Check, Search, X } from 'lucide-react';

export interface UserSelectItem {
  userId: string;
  email: string;
  name?: string;
}

interface ZohoUserSelectDropdownProps {
  users: UserSelectItem[];
  selectedUserIds: string[];
  onChange: (selectedIds: string[]) => void;
}

export default function ZohoUserSelectDropdown({
  users,
  selectedUserIds,
  onChange,
}: ZohoUserSelectDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Click outside listener
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const allSelected = users.length > 0 && selectedUserIds.length === users.length;
  const isIndeterminate = selectedUserIds.length > 0 && selectedUserIds.length < users.length;

  // Toggle All Users
  const handleToggleAll = () => {
    if (allSelected) {
      onChange([]);
    } else {
      onChange(users.map((u) => u.userId));
    }
  };

  // Toggle individual user
  const handleToggleUser = (userId: string) => {
    if (selectedUserIds.includes(userId)) {
      onChange(selectedUserIds.filter((id) => id !== userId));
    } else {
      onChange([...selectedUserIds, userId]);
    }
  };

  // Filter users by search
  const filteredUsers = users.filter((u) =>
    u.email.toLowerCase().includes(search.toLowerCase())
  );

  // Button label
  const getButtonLabel = () => {
    if (users.length === 0) return 'No Users';
    if (allSelected) return `All Users (${users.length})`;
    if (selectedUserIds.length === 0) return 'Select Users';
    if (selectedUserIds.length === 1) {
      const u = users.find((item) => item.userId === selectedUserIds[0]);
      return u?.email || '1 User Selected';
    }
    return `${selectedUserIds.length} Users Selected`;
  };

  return (
    <div className="relative inline-block text-left" ref={dropdownRef}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex items-center gap-2 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800/80 text-zinc-800 dark:text-zinc-200 border border-zinc-200/90 dark:border-zinc-800 rounded-xl px-3 py-2 shadow-xs text-xs font-semibold transition-colors cursor-pointer hover:border-zinc-300 dark:hover:border-zinc-700"
        aria-expanded={isOpen}
      >
        <div className="p-1 rounded-md bg-[#34c4f2]/10 text-[#34c4f2]">
          <Users className="w-3.5 h-3.5" />
        </div>
        <span className="max-w-[200px] truncate text-zinc-900 dark:text-white font-bold">
          {getButtonLabel()}
        </span>
        <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute left-0 top-full mt-2 z-50 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-xl shadow-zinc-900/10 dark:shadow-black/60 w-72 sm:w-80 p-3 text-zinc-900 dark:text-zinc-100 animate-in fade-in zoom-in-95 duration-150">
          {/* Search box inside dropdown */}
          <div className="relative mb-2">
            <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search user email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-7 py-1.5 bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700/80 rounded-xl text-xs text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-[#34c4f2]"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-white"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Option 1: All Users */}
          <div className="pt-0.5 pb-1">
            <label
              className="flex items-center gap-2.5 px-2 py-1.5 rounded-xl hover:bg-zinc-50 dark:hover:bg-zinc-800/60 cursor-pointer text-xs font-bold text-zinc-900 dark:text-white transition-colors"
            >
              <input
                type="checkbox"
                checked={allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = isIndeterminate;
                }}
                onChange={handleToggleAll}
                className="w-4 h-4 rounded text-[#34c4f2] bg-white dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 focus:ring-[#34c4f2] focus:ring-offset-0 cursor-pointer accent-[#34c4f2]"
              />
              <span>All Users</span>
              <span className="ml-auto text-[10px] text-zinc-400 font-normal">
                ({users.length})
              </span>
            </label>
          </div>

          <div className="border-t border-zinc-100 dark:border-zinc-800 my-1" />

          {/* Individual User Checkbox List */}
          <div className="max-h-56 overflow-y-auto space-y-0.5 pr-1 divide-y divide-zinc-100/50 dark:divide-zinc-800/50">
            {filteredUsers.length === 0 ? (
              <div className="py-4 text-center text-xs text-zinc-400">
                No users match search
              </div>
            ) : (
              filteredUsers.map((u) => {
                const isChecked = selectedUserIds.includes(u.userId);
                return (
                  <label
                    key={u.userId}
                    className={`flex items-center gap-2.5 px-2 py-1.5 rounded-xl cursor-pointer text-xs transition-colors ${
                      isChecked
                        ? 'bg-[#34c4f2]/10 dark:bg-[#34c4f2]/20 text-[#1689aa] dark:text-[#34c4f2] font-semibold'
                        : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => handleToggleUser(u.userId)}
                      className="w-4 h-4 rounded text-[#34c4f2] bg-white dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 focus:ring-[#34c4f2] focus:ring-offset-0 cursor-pointer accent-[#34c4f2] shrink-0"
                    />
                    <span className="truncate">{u.email}</span>
                  </label>
                );
              })
            )}
          </div>

          {/* Dropdown Footer */}
          <div className="flex items-center justify-between pt-2.5 mt-2 border-t border-zinc-100 dark:border-zinc-800 text-[11px] text-zinc-500 dark:text-zinc-400">
            <span>
              {selectedUserIds.length} of {users.length} selected
            </span>
            <div className="flex items-center gap-2 font-semibold">
              <button
                type="button"
                onClick={() => onChange(users.map((u) => u.userId))}
                className="text-[#1689aa] dark:text-[#34c4f2] hover:underline cursor-pointer"
              >
                Select All
              </button>
              <span>•</span>
              <button
                type="button"
                onClick={() => onChange([])}
                className="text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-white cursor-pointer"
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
