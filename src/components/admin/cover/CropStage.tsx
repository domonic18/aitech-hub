"use client";

/**
 * 裁剪器(原型 admin-cover 左卡;arch/07 §7「react-easy-crop 等价方案」):
 * 拖拽取景 + 缩放(1-3×)+ 旋转(±15°)滑杆;croppedAreaPixels 坐标相对旋转后
 * 图幅,与 cover/templates.ts 的导出约定一致。样式库内自注入,免引 css。
 */
import Cropper from "react-easy-crop";
import type { Area } from "react-easy-crop";

export type { Area };

export default function CropStage({
  url,
  aspect,
  crop,
  zoom,
  rotation,
  areaPx,
  onCropChange,
  onZoomChange,
  onRotationChange,
  onCropComplete,
}: {
  url: string;
  aspect: number;
  crop: { x: number; y: number };
  zoom: number;
  rotation: number;
  /** 当前选区像素(实时回显选区尺寸;未就绪为 null) */
  areaPx: Area | null;
  onCropChange: (c: { x: number; y: number }) => void;
  onZoomChange: (z: number) => void;
  onRotationChange: (r: number) => void;
  onCropComplete: (areaPx: Area) => void;
}): React.ReactElement {
  return (
    <div>
      <div className="relative h-64 w-full overflow-hidden rounded-sm border border-line bg-panel-2 sm:h-72">
        <Cropper
          image={url}
          crop={crop}
          zoom={zoom}
          rotation={rotation}
          aspect={aspect}
          objectFit="contain"
          onCropChange={onCropChange}
          onZoomChange={onZoomChange}
          onRotationChange={onRotationChange}
          onCropComplete={(_a, px) => onCropComplete(px)}
        />
      </div>
      <div className="mt-3 flex flex-col gap-2 text-[11px] text-text-3">
        <label className="flex items-center gap-2">
          <span className="w-8 flex-none">缩放</span>
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            onChange={(e) => onZoomChange(Number(e.target.value))}
            className="h-1 flex-1 accent-[var(--accent)]"
          />
          <span className="w-10 flex-none text-right font-mono">{zoom.toFixed(2)}×</span>
        </label>
        <label className="flex items-center gap-2">
          <span className="w-8 flex-none">旋转</span>
          <input
            type="range"
            min={-15}
            max={15}
            step={0.5}
            value={rotation}
            onChange={(e) => onRotationChange(Number(e.target.value))}
            className="h-1 flex-1 accent-[var(--accent)]"
          />
          <span className="w-10 flex-none text-right font-mono">{rotation.toFixed(1)}°</span>
        </label>
        <div className="flex flex-wrap gap-x-4 font-mono">
          <span>
            选区{" "}
            <b className="text-text-2">
              {areaPx ? `${Math.round(areaPx.width)} × ${Math.round(areaPx.height)}` : "—"} px
            </b>
          </span>
          <span>拖拽取景,滑杆微调;导出按模板 cover-fit 居中适配</span>
        </div>
      </div>
    </div>
  );
}
