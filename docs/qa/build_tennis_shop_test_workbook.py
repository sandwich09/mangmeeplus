#!/usr/bin/env python3
"""สร้างไฟล์ Excel สำหรับกรอกผลทดสอบ จากเอกสาร tennis-shop-e2e-test-cases-2026-07-29.md

รันใหม่ได้ทุกครั้งที่แก้ไฟล์ .md:
    python3 docs/qa/build_tennis_shop_test_workbook.py

ผลลัพธ์: docs/qa/tennis-shop-e2e-test-cases-2026-07-29.xlsx
"""
from __future__ import annotations

import re
from pathlib import Path

from openpyxl import Workbook
from openpyxl.formatting.rule import CellIsRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

HERE = Path(__file__).resolve().parent
SOURCE = HERE / 'tennis-shop-e2e-test-cases-2026-07-29.md'
TARGET = HERE / 'tennis-shop-e2e-test-cases-2026-07-29.xlsx'

STATUS_CHOICES = ['ยังไม่ทดสอบ', 'Passed', 'Failed', 'Blocked', 'N/A']

# ---- palette ---------------------------------------------------------------
NAVY = '1F3864'
HEADER_FILL = PatternFill('solid', fgColor=NAVY)
HEADER_FONT = Font(color='FFFFFF', bold=True, size=11)
TITLE_FONT = Font(color=NAVY, bold=True, size=14)
SECTION_FILL = PatternFill('solid', fgColor='D9E2F3')
SECTION_FONT = Font(color=NAVY, bold=True, size=11)
THIN = Side(style='thin', color='BFBFBF')
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
TOP_WRAP = Alignment(vertical='top', wrap_text=True)
CENTER = Alignment(vertical='center', horizontal='center', wrap_text=True)

PRI_FILL = {
    'P0': PatternFill('solid', fgColor='F8CBAD'),
    'P1': PatternFill('solid', fgColor='FFE699'),
    'P2': PatternFill('solid', fgColor='E2EFDA'),
}


# ---- markdown parsing ------------------------------------------------------
def strip_md(text: str) -> str:
    """ลบมาร์กอัป markdown ที่ไม่จำเป็นออกจากข้อความในเซลล์"""
    text = re.sub(r'\*\*(.+?)\*\*', r'\1', text)
    text = re.sub(r'`(.+?)`', r'\1', text)
    text = text.replace('<br>', '\n').replace('\\|', '|')
    return text.strip()


def clean_group(heading: str) -> str:
    """'5.5.4 หมวดหมู่ — EXP-CAT  (Owner / Admin เท่านั้น)' -> 'หมวดหมู่ — EXP-CAT'"""
    heading = re.sub(r'^\d+(\.\d+)*\.?\s*', '', heading)
    heading = re.sub(r'\s*\([^)]*\)\s*$', '', heading)
    return heading.strip()


def parse_tables(md: str):
    """คืน list ของ (heading_path, header_cells, rows) ตามลำดับที่ปรากฏในเอกสาร"""
    tables = []
    heading = {2: '', 3: '', 4: ''}
    lines = md.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        m = re.match(r'^(#{2,4})\s+(.*)$', line)
        if m:
            level = len(m.group(1))
            heading[level] = strip_md(m.group(2))
            for deeper in range(level + 1, 5):
                heading[deeper] = ''
            i += 1
            continue
        if line.startswith('|') and i + 1 < len(lines) and re.match(r'^\|[\s:|-]+\|$', lines[i + 1]):
            header = [strip_md(c) for c in line.strip().strip('|').split('|')]
            i += 2
            rows = []
            while i < len(lines) and lines[i].startswith('|'):
                cells = [strip_md(c) for c in lines[i].strip().strip('|').split('|')]
                cells += [''] * (len(header) - len(cells))
                rows.append(cells[: len(header)])
                i += 1
            path = [heading[level] for level in (2, 3, 4) if heading[level]]
            tables.append((path, header, rows))
            continue
        i += 1
    return tables


# ---- sheet builders --------------------------------------------------------
def style_header(ws, row: int, width_map: dict[int, int]):
    for col, width in width_map.items():
        ws.column_dimensions[get_column_letter(col)].width = width
        cell = ws.cell(row=row, column=col)
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.alignment = CENTER
        cell.border = BORDER
    ws.row_dimensions[row].height = 30


def add_status_validation(ws, first_row: int, last_row: int, col: int):
    dv = DataValidation(
        type='list',
        formula1='"' + ','.join(STATUS_CHOICES) + '"',
        allow_blank=True,
        showDropDown=False,
    )
    dv.error = 'เลือกได้เฉพาะ: ' + ' / '.join(STATUS_CHOICES)
    dv.errorTitle = 'สถานะไม่ถูกต้อง'
    ws.add_data_validation(dv)
    letter = get_column_letter(col)
    rng = f'{letter}{first_row}:{letter}{last_row}'
    dv.add(rng)
    ws.conditional_formatting.add(
        rng,
        CellIsRule(operator='equal', formula=['"Passed"'],
                   fill=PatternFill('solid', fgColor='C6EFCE'), font=Font(color='006100', bold=True)),
    )
    ws.conditional_formatting.add(
        rng,
        CellIsRule(operator='equal', formula=['"Failed"'],
                   fill=PatternFill('solid', fgColor='FFC7CE'), font=Font(color='9C0006', bold=True)),
    )
    ws.conditional_formatting.add(
        rng,
        CellIsRule(operator='equal', formula=['"Blocked"'],
                   fill=PatternFill('solid', fgColor='FFEB9C'), font=Font(color='9C5700', bold=True)),
    )
    ws.conditional_formatting.add(
        rng,
        CellIsRule(operator='equal', formula=['"N/A"'],
                   fill=PatternFill('solid', fgColor='EDEDED'), font=Font(color='808080')),
    )


def build_test_cases(wb: Workbook, tables) -> tuple[str, int, int]:
    ws = wb.create_sheet('Test Cases')
    headers = ['กลุ่มเมนู', 'Test ID', 'Pri', 'บทบาท (Role)', 'เงื่อนไขเริ่มต้น', 'ขั้นตอนการทดสอบ',
               'ผลที่คาดหวัง', 'สถานะ', 'ผลที่เกิดขึ้นจริง', 'ผู้ทดสอบ', 'วันที่ทดสอบ', 'Issue / หมายเหตุ']
    ws.append(headers)
    style_header(ws, 1, {1: 26, 2: 13, 3: 6, 4: 20, 5: 34, 6: 52, 7: 52, 8: 14, 9: 34, 10: 14, 11: 13, 12: 26})

    for path, header, rows in tables:
        if not header or header[0] != 'ID':
            continue
        group = clean_group(path[-1] if path else '')
        six_col = len(header) >= 6 and 'ขั้นตอน' in header
        for cells in rows:
            if six_col:
                tid, pri, role, pre, steps, expected = cells[0], cells[1], cells[2], cells[3], cells[4], cells[5]
            else:  # ตาราง PERM / EDGE: ID | Pri | คำอธิบาย | ผลที่คาดหวัง
                tid, pri, role, pre, steps, expected = cells[0], cells[1], 'ตามคำอธิบาย', '', cells[2], cells[3]
            ws.append([group, tid, pri, role, pre, steps, expected, 'ยังไม่ทดสอบ', '', '', '', ''])

    last = ws.max_row
    for row in ws.iter_rows(min_row=2, max_row=last, max_col=len(headers)):
        for cell in row:
            cell.alignment = TOP_WRAP
            cell.border = BORDER
        row[2].alignment = CENTER
        row[7].alignment = CENTER
        fill = PRI_FILL.get(row[2].value)
        if fill:
            row[2].fill = fill

    ws.freeze_panes = 'C2'
    ws.auto_filter.ref = f'A1:{get_column_letter(len(headers))}{last}'
    add_status_validation(ws, 2, last, 8)
    return ws.title, 2, last


def build_flows(wb: Workbook, tables) -> tuple[str, int, int]:
    ws = wb.create_sheet('E2E Flows')
    headers = ['Flow', 'ขั้นที่', 'ผู้ทำ (Role)', 'การกระทำ', 'จุดตรวจ / ผลที่คาดหวัง',
               'สถานะ', 'ผลที่เกิดขึ้นจริง', 'ผู้ทดสอบ', 'วันที่ทดสอบ', 'Issue / หมายเหตุ']
    ws.append(headers)
    style_header(ws, 1, {1: 44, 2: 8, 3: 18, 4: 50, 5: 52, 6: 14, 7: 34, 8: 14, 9: 13, 10: 26})

    for path, header, rows in tables:
        if header[:2] != ['ขั้น', 'ผู้ทำ']:
            continue
        flow = path[-1] if path else ''
        for cells in rows:
            ws.append([flow, cells[0], cells[1], cells[2], cells[3], 'ยังไม่ทดสอบ', '', '', '', ''])

    last = ws.max_row
    for row in ws.iter_rows(min_row=2, max_row=last, max_col=len(headers)):
        for cell in row:
            cell.alignment = TOP_WRAP
            cell.border = BORDER
        row[1].alignment = CENTER
        row[5].alignment = CENTER

    ws.freeze_panes = 'C2'
    ws.auto_filter.ref = f'A1:{get_column_letter(len(headers))}{last}'
    add_status_validation(ws, 2, last, 6)
    return ws.title, 2, last


def dump_tables(wb: Workbook, sheet_name: str, tables, widths: list[int], title: str, note: str = ''):
    """เขียนหลายตารางเรียงลงชีตเดียว พร้อมหัวข้อคั่น (ใช้กับข้อมูลอ้างอิงที่ไม่ต้องกรอกสถานะ)"""
    ws = wb.create_sheet(sheet_name)
    for idx, width in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(idx)].width = width

    ws.cell(row=1, column=1, value=title).font = TITLE_FONT
    row = 2
    if note:
        ws.cell(row=row, column=1, value=note).alignment = TOP_WRAP
        row += 1
    row += 1

    for path, header, rows in tables:
        label = path[-1] if path else ''
        cell = ws.cell(row=row, column=1, value=label)
        cell.font = SECTION_FONT
        cell.fill = SECTION_FILL
        for col in range(1, len(widths) + 1):
            ws.cell(row=row, column=col).fill = SECTION_FILL
        row += 1

        for col, name in enumerate(header, start=1):
            c = ws.cell(row=row, column=col, value=name)
            c.fill = HEADER_FILL
            c.font = HEADER_FONT
            c.alignment = CENTER
            c.border = BORDER
        row += 1

        for cells in rows:
            for col, value in enumerate(cells, start=1):
                c = ws.cell(row=row, column=col, value=value)
                c.alignment = TOP_WRAP
                c.border = BORDER
            row += 1
        row += 1
    return ws


def build_summary(wb: Workbook, cases: tuple[str, int, int], flows: tuple[str, int, int]):
    ws = wb.create_sheet('สรุปผลทดสอบ', 0)
    ws.column_dimensions['A'].width = 30
    for letter in 'BCDEFG':
        ws.column_dimensions[letter].width = 15

    ws['A1'] = 'สรุปผลทดสอบ E2E — ACE Tennis Pro Shop'
    ws['A1'].font = TITLE_FONT
    ws['A2'] = 'กรอกสถานะในคอลัมน์ "สถานะ" ของชีต Test Cases และ E2E Flows — ตัวเลขด้านล่างคำนวณอัตโนมัติ'
    ws['A3'] = 'สถานะที่เลือกได้: ' + ' / '.join(STATUS_CHOICES)

    ws['A5'] = 'รอบทดสอบ / Build'
    ws['A6'] = 'ผู้ทดสอบหลัก'
    ws['A7'] = 'วันที่เริ่ม'
    ws['A8'] = 'วันที่สิ้นสุด'
    for r in range(5, 9):
        ws.cell(row=r, column=1).font = Font(bold=True)
        ws.cell(row=r, column=2).fill = PatternFill('solid', fgColor='FFF2CC')
        ws.cell(row=r, column=2).border = BORDER

    case_sheet, case_first, case_last = cases
    flow_sheet, flow_first, flow_last = flows
    case_rng = f"'{case_sheet}'!$H${case_first}:$H${case_last}"
    flow_rng = f"'{flow_sheet}'!$F${flow_first}:$F${flow_last}"
    pri_rng = f"'{case_sheet}'!$C${case_first}:$C${case_last}"

    row = 10
    headers = ['หมวด', 'ทั้งหมด', 'Passed', 'Failed', 'Blocked', 'N/A', 'ยังไม่ทดสอบ']
    for col, name in enumerate(headers, start=1):
        c = ws.cell(row=row, column=col, value=name)
        c.fill = HEADER_FILL
        c.font = HEADER_FONT
        c.alignment = CENTER
        c.border = BORDER

    def status_row(label: str, total: str, counters: list[str]):
        nonlocal row
        row += 1
        ws.cell(row=row, column=1, value=label).font = Font(bold=True)
        ws.cell(row=row, column=2, value=total)
        for col, formula in enumerate(counters, start=3):
            ws.cell(row=row, column=col, value=formula)
        for col in range(1, 8):
            ws.cell(row=row, column=col).border = BORDER
            if col > 1:
                ws.cell(row=row, column=col).alignment = CENTER

    status_row(
        'Test Cases ทั้งหมด',
        f'=COUNTA({case_rng})',
        [f'=COUNTIF({case_rng},"{s}")' for s in ['Passed', 'Failed', 'Blocked', 'N/A', 'ยังไม่ทดสอบ']],
    )
    for pri in ('P0', 'P1', 'P2'):
        status_row(
            f'  — {pri}',
            f'=COUNTIF({pri_rng},"{pri}")',
            [f'=COUNTIFS({pri_rng},"{pri}",{case_rng},"{s}")'
             for s in ['Passed', 'Failed', 'Blocked', 'N/A', 'ยังไม่ทดสอบ']],
        )
    status_row(
        'E2E Flow (รายขั้นตอน)',
        f'=COUNTA({flow_rng})',
        [f'=COUNTIF({flow_rng},"{s}")' for s in ['Passed', 'Failed', 'Blocked', 'N/A', 'ยังไม่ทดสอบ']],
    )

    row += 2
    ws.cell(row=row, column=1, value='เกณฑ์ผ่าน (Exit Criteria)').font = SECTION_FONT
    criteria = [
        ('P0 ต้องผ่าน 100%', f'=IF(COUNTIF({pri_rng},"P0")=0,"-",'
                             f'IF(COUNTIFS({pri_rng},"P0",{case_rng},"Passed")=COUNTIF({pri_rng},"P0"),"ผ่าน","ยังไม่ผ่าน"))'),
        ('P1 ต้องผ่าน ≥ 95%', f'=IF(COUNTIF({pri_rng},"P1")=0,"-",'
                              f'IF(COUNTIFS({pri_rng},"P1",{case_rng},"Passed")/COUNTIF({pri_rng},"P1")>=0.95,"ผ่าน","ยังไม่ผ่าน"))'),
        ('P2 ต้องผ่าน ≥ 85%', f'=IF(COUNTIF({pri_rng},"P2")=0,"-",'
                              f'IF(COUNTIFS({pri_rng},"P2",{case_rng},"Passed")/COUNTIF({pri_rng},"P2")>=0.85,"ผ่าน","ยังไม่ผ่าน"))'),
        ('ไม่มีเคสสถานะ Failed', f'=IF(COUNTIF({case_rng},"Failed")+COUNTIF({flow_rng},"Failed")=0,"ผ่าน","ยังไม่ผ่าน")'),
    ]
    for label, formula in criteria:
        row += 1
        ws.cell(row=row, column=1, value=label).border = BORDER
        c = ws.cell(row=row, column=2, value=formula)
        c.alignment = CENTER
        c.border = BORDER
        ws.conditional_formatting.add(
            f'B{row}',
            CellIsRule(operator='equal', formula=['"ผ่าน"'],
                       fill=PatternFill('solid', fgColor='C6EFCE'), font=Font(color='006100', bold=True)),
        )
        ws.conditional_formatting.add(
            f'B{row}',
            CellIsRule(operator='equal', formula=['"ยังไม่ผ่าน"'],
                       fill=PatternFill('solid', fgColor='FFC7CE'), font=Font(color='9C0006', bold=True)),
        )

    row += 2
    ws.cell(row=row, column=1, value='ข้อควรทราบก่อนทดสอบ').font = SECTION_FONT
    for note in [
        'เมนู "ปิดงวด" ยังเป็นหน้า placeholder ("เร็วๆ นี้") — เคส CLS ตรวจสถานะที่ถูกต้องของงานที่ยังไม่เสร็จ',
        'Admin ไม่เห็นเมนู "เอกสารขายและรับชำระ" และ "สมุดรายวัน" — เป็นการออกแบบที่ตั้งใจตามโค้ด ไม่ใช่บั๊ก',
        'เมนูย่อยของ "ค่าใช้จ่ายและใบเสร็จ" มี 7 รายการ (มี "ลายเซ็นบริษัท" เพิ่มจากที่ระบุไว้เดิม)',
        'ต้อง seed ฐานข้อมูลใหม่ก่อนเริ่มทุกรอบทดสอบ และใช้บัญชี qa.* ตามชีต "บัญชีทดสอบ"',
    ]:
        row += 1
        ws.cell(row=row, column=1, value='• ' + note).alignment = Alignment(vertical='top', wrap_text=True)
        ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=7)
        ws.row_dimensions[row].height = 30


def main() -> None:
    md = SOURCE.read_text(encoding='utf-8')
    tables = parse_tables(md)

    wb = Workbook()
    wb.remove(wb.active)

    cases = build_test_cases(wb, tables)
    flows = build_flows(wb, tables)

    accounts = [t for t in tables if t[0] and t[0][-1].startswith('2.1')]
    dump_tables(wb, 'บัญชีทดสอบ', accounts, [16, 18, 20, 26, 34],
                'บัญชีทดสอบ (seed ไว้แล้วใน apps/api/prisma/seed.ts)',
                'Company ID: seed-local-company · บัญชีสำรอง: Owner / Owner@12345, Company / Company@123')

    data_tables = [t for t in tables if t[0] and re.match(r'^3\.\d', t[0][-1])]
    dump_tables(wb, 'ข้อมูลทดสอบ', data_tables, [22, 34, 18, 16, 14, 16, 40],
                'ชุดข้อมูลทดสอบเสมือนจริง — ACE Tennis Pro Shop (ร้านอุปกรณ์เทนนิส + คอร์สเรียน + ขายผ่าน LINE OA)')

    matrix_tables = [t for t in tables if t[0] and re.match(r'^4(\.\d)?', t[0][-1])]
    dump_tables(wb, 'เมทริกซ์สิทธิ์', matrix_tables, [34, 12, 14, 10, 12, 10, 12, 11, 13, 12, 10],
                'เมทริกซ์การมองเห็นเมนูตามบทบาท',
                'คำนวณจาก ROLE_GRANTS + WORKSPACE_MODULES ในโค้ดจริง · ✅ = เห็นเมนู/เข้าได้ · ❌ = ไม่เห็น และเปิด URL ตรงต้องถูกบล็อก')

    build_summary(wb, cases, flows)
    wb.active = 0
    wb.save(TARGET)

    print(f'เขียนไฟล์: {TARGET}')
    print(f'  Test Cases : {cases[2] - cases[1] + 1} เคส')
    print(f'  E2E Flows  : {flows[2] - flows[1] + 1} ขั้นตอน')


if __name__ == '__main__':
    main()
