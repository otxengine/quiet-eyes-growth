import React from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

/**
 * DataTable — Reusable RTL table wrapper
 * Props:
 *   columns: Array of { key, label, className? }
 *   rows:    Array of objects (keyed by column.key) OR Array of ReactNode arrays
 *   renderCell: optional function(row, col) => ReactNode
 *   emptyText: string shown when rows is empty
 */
export default function DataTable({ columns = [], rows = [], renderCell, emptyText = 'אין נתונים' }) {
  return (
    <div className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-100">
      <Table>
        <TableHeader>
          <TableRow className="bg-gray-50 border-b border-gray-100">
            {columns.map((col) => (
              <TableHead
                key={col.key}
                className={`text-right text-xs font-semibold text-foreground-secondary py-3 px-4 ${col.className || ''}`}
              >
                {col.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length} className="text-center text-foreground-secondary py-10">
                {emptyText}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row, i) => (
              <TableRow key={i} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                {columns.map((col) => (
                  <TableCell key={col.key} className={`text-right py-3 px-4 text-sm ${col.cellClassName || ''}`}>
                    {renderCell ? renderCell(row, col) : row[col.key]}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
