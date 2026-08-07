#!/usr/bin/env python3
"""
สร้างรูป "กรอบเส้นประ + ไอคอนคลิปหนีบกระดาษ" สำหรับใส่ในการ์ดแนบรูปใบเสร็จ
เพราะ LINE Flex Message ไม่รองรับเส้นขอบแบบประ จึงต้องทำเป็นรูปภาพ

รัน:  pip install pillow && python3 scripts/line-oa/make-dropzone.py
ผลลัพธ์: apps/web/public/assets/line/receipt-dropzone.png

รูปนี้ "ไม่มีตัวหนังสือ" โดยตั้งใจ — คำบรรยาย ("แตะปุ่ม ... ด้านล่าง") อยู่เป็นบรรทัดข้อความจริงใน
Flex card ที่ buildReceiptCapturePrompt() แทน เพราะถ้าฝังคำลงในรูป พอเปลี่ยนคำบนปุ่มทีไรรูปก็ค้างทันที
และการเรนเดอร์สระ/วรรณยุกต์ไทยด้วย Pillow ต้องมี libraqm ซึ่งไม่ได้มีทุกเครื่อง (ถ้าไม่มี สระจะลอย)
รูปที่ commit ไว้แล้วใช้ได้เลย สคริปต์นี้มีไว้เผื่อต้องแก้สี/ไอคอนเท่านั้น
"""

import math
import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(REPO_ROOT, "apps", "web", "public", "assets", "line", "receipt-dropzone.png")

# ---- ขนาดและสี -------------------------------------------------------
SCALE = 4                      # วาดใหญ่ 4 เท่าแล้วย่อ เพื่อให้ขอบเนียน
W, H = 260 * SCALE, 150 * SCALE

BG_CARD = (255, 255, 255, 255)  # พื้นการ์ดสีขาว (ให้กลืนกับ bubble)
BG_ZONE = (240, 253, 244, 255)  # เขียวอ่อนในกรอบ
BORDER = (167, 224, 190, 255)   # สีเส้นประ
GREEN = (22, 145, 82, 255)      # เขียวเข้มของปุ่มกล้อง
TEXT = (22, 145, 82, 255)

RADIUS = 14 * SCALE
DASH_ON = 9 * SCALE
DASH_OFF = 7 * SCALE
STROKE = int(1.6 * SCALE)
PAD = 3 * SCALE                 # ระยะขอบรูป


def rounded_rect_path(x0, y0, x1, y1, r, steps_per_corner=24):
    """คืนลิสต์จุดที่ไล่ตามเส้นรอบรูปสี่เหลี่ยมมุมมน (ตามเข็มนาฬิกา)"""
    pts = []

    def arc(cx, cy, start_deg, end_deg):
        for i in range(steps_per_corner + 1):
            t = start_deg + (end_deg - start_deg) * i / steps_per_corner
            a = math.radians(t)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))

    pts.append((x0 + r, y0))
    pts.append((x1 - r, y0))
    arc(x1 - r, y0 + r, -90, 0)      # มุมขวาบน
    pts.append((x1, y1 - r))
    arc(x1 - r, y1 - r, 0, 90)       # มุมขวาล่าง
    pts.append((x0 + r, y1))
    arc(x0 + r, y1 - r, 90, 180)     # มุมซ้ายล่าง
    pts.append((x0, y0 + r))
    arc(x0 + r, y0 + r, 180, 270)    # มุมซ้ายบน
    pts.append((x0 + r, y0))
    return pts


def draw_dashed_path(draw, pts, color, width, dash_on, dash_off):
    """เดินตามเส้น path แล้ววาดเป็นช่วง ๆ ให้ได้เส้นประ"""
    remaining = dash_on
    drawing = True
    for i in range(len(pts) - 1):
        x0, y0 = pts[i]
        x1, y1 = pts[i + 1]
        seg = math.hypot(x1 - x0, y1 - y0)
        if seg == 0:
            continue
        pos = 0.0
        while pos < seg:
            step = min(remaining, seg - pos)
            t0, t1 = pos / seg, (pos + step) / seg
            if drawing:
                draw.line(
                    [
                        (x0 + (x1 - x0) * t0, y0 + (y1 - y0) * t0),
                        (x0 + (x1 - x0) * t1, y0 + (y1 - y0) * t1),
                    ],
                    fill=color,
                    width=width,
                )
            pos += step
            remaining -= step
            if remaining <= 1e-6:
                drawing = not drawing
                remaining = dash_on if drawing else dash_off


# คลิปหนีบกระดาษวาดในระบบพิกัด 24x24 (แบบเดียวกับไอคอน attach ทั่วไป)
# แล้วค่อยสเกลลงปุ่ม เพื่อให้สัดส่วนคงที่ไม่ว่าจะขยายเท่าไร
CLIP_PATH = [
    ("move", 16.5, 6.0),
    ("line", 16.5, 17.5),
    ("arc", 12.5, 17.5, 4.0, 0, 180),      # โค้งใหญ่ด้านล่าง
    ("line", 8.5, 5.0),
    ("arc", 11.0, 5.0, 2.5, 180, 360),     # โค้งด้านบน
    ("line", 13.5, 15.5),
    ("arc", 12.5, 15.5, 1.0, 0, 180),      # โค้งเล็กด้านล่าง
    ("line", 11.5, 6.0),
]


def draw_paperclip_icon(draw, cx, cy, size, color, width):
    """วาดไอคอนคลิปหนีบกระดาษสีขาวตรงกลางปุ่ม (สื่อถึงการแนบไฟล์)"""
    k = size / 24.0
    ox, oy = cx - size / 2, cy - size / 2

    def to_canvas(x, y):
        return (ox + x * k, oy + y * k)

    pts = []
    for segment in CLIP_PATH:
        if segment[0] == "move":
            pts.append(to_canvas(segment[1], segment[2]))
        elif segment[0] == "line":
            pts.append(to_canvas(segment[1], segment[2]))
        else:
            _, acx, acy, r, start, end = segment
            steps = 28
            for i in range(steps + 1):
                t = math.radians(start + (end - start) * i / steps)
                pts.append(to_canvas(acx + r * math.cos(t), acy + r * math.sin(t)))

    # joint="curve" ทำให้รอยต่อไม่เป็นเหลี่ยม, แล้วปิดหัวท้ายด้วยวงกลมให้เป็นปลายมน
    draw.line(pts, fill=color, width=width, joint="curve")
    for x, y in (pts[0], pts[-1]):
        r = width / 2
        draw.ellipse([x - r, y - r, x + r, y + r], fill=color)


def main():
    img = Image.new("RGBA", (W, H), BG_CARD)
    d = ImageDraw.Draw(img)

    # กรอบเส้นประ + พื้นเขียวอ่อน
    x0, y0, x1, y1 = PAD, PAD, W - PAD, H - PAD
    d.rounded_rectangle([x0, y0, x1, y1], radius=RADIUS, fill=BG_ZONE)
    path = rounded_rect_path(x0, y0, x1, y1, RADIUS)
    draw_dashed_path(d, path, BORDER, STROKE, DASH_ON, DASH_OFF)

    # ปุ่มสีเขียว + คลิปหนีบกระดาษ วางกลางกรอบ (ไม่มีข้อความ — ดูหมายเหตุหัวไฟล์)
    btn = 52 * SCALE
    bx, by = W / 2, H / 2
    d.rounded_rectangle(
        [bx - btn / 2, by - btn / 2, bx + btn / 2, by + btn / 2],
        radius=btn * 0.30,
        fill=GREEN,
    )
    draw_paperclip_icon(d, bx, by, btn * 0.62, (255, 255, 255, 255), int(2.3 * SCALE))

    # ย่อกลับให้ขอบเนียน
    final = img.resize((W // SCALE * 2, H // SCALE * 2), Image.LANCZOS)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    final.convert("RGB").save(OUT, "PNG", optimize=True)
    print(f"เขียนไฟล์แล้ว: {OUT}  ({final.width}x{final.height})")


if __name__ == "__main__":
    main()
