"""Image forensics service — detects tampered/manipulated invoice images.

Covers the attack chain: PNG/JPEG invoice → PS edit amounts → re-save as JPEG → upload.

Detection techniques:
1. Metadata/EXIF — Photoshop/editor software traces in EXIF, XMP, PNG chunks
2. Error Level Analysis (ELA) — edited regions show different compression error
3. JPEG double compression — re-saving after edit leaves DCT quantization artifacts
4. Noise consistency — editing disrupts natural noise patterns
"""

import io
import logging
import time
from typing import Optional, Dict, Any, List

import numpy as np
from PIL import Image
from PIL.ExifTags import TAGS

logger = logging.getLogger(__name__)

# ── Photoshop / editor keywords (lowercase) ──────────────────────────
_EDITOR_KEYWORDS = [
    'photoshop', 'adobe', 'gimp', 'paint.net', 'pixlr',
    'canva', 'figma', 'sketch', 'affinity', 'corel',
    'lightroom', 'capture one', 'darktable', 'inkscape',
    'photopea', 'paint tool sai', 'krita', 'microsoft photo',
]


class ImageForensicsService:
    """Stateless service: analyze() accepts raw bytes, returns result dict."""

    def analyze(self, file_data: bytes, file_type: str) -> Dict[str, Any]:
        """Run all forensics checks. Returns a dict ready for JSONB storage."""
        t0 = time.time()
        findings: List[str] = []

        try:
            image = Image.open(io.BytesIO(file_data))
        except Exception as e:
            logger.error(f"Forensics: cannot open image ({e})")
            return self._empty_result(f'无法打开图像: {e}')

        # 1 ─ Metadata ────────────────────────────────────────────────
        meta = self._analyze_metadata(image, file_data)
        findings.extend(meta.get('findings', []))

        # 2 ─ ELA ─────────────────────────────────────────────────────
        ela = self._error_level_analysis(image)
        findings.extend(ela.get('findings', []))

        # 3 ─ JPEG double compression ─────────────────────────────────
        jpeg = self._detect_jpeg_double_compression(image, file_data)
        findings.extend(jpeg.get('findings', []))

        # 4 ─ Noise consistency ───────────────────────────────────────
        noise = self._analyze_noise_consistency(image)
        findings.extend(noise.get('findings', []))

        # ── Scoring ──────────────────────────────────────────────────
        score = self._risk_score(meta, ela, jpeg, noise)
        level = 'high' if score >= 70 else ('medium' if score >= 40 else 'low')

        dur = int((time.time() - t0) * 1000)
        logger.info(f"Forensics done: score={score} level={level} findings={len(findings)} {dur}ms")

        return {
            'risk_score': score,
            'risk_level': level,
            'metadata_result': meta,
            'ela_result': ela,
            'jpeg_double_compression_result': jpeg,
            'noise_consistency_result': noise,
            'summary': self._summary(score, level, findings),
            'details': findings,
        }

    # ── 1. Metadata ──────────────────────────────────────────────────

    def _analyze_metadata(self, image: Image.Image, raw: bytes) -> Dict[str, Any]:
        findings: List[str] = []
        exif_data: Dict[str, Any] = {}
        flags = {
            'has_software_tag': False,
            'software_suspicious': False,
            'has_xmp': False,
            'xmp_creator_tool': None,
            'datetime_inconsistent': False,
            'no_exif': False,
        }

        # ── EXIF ──
        try:
            exif = image.getexif()
            if exif:
                for tag_id, value in exif.items():
                    name = TAGS.get(tag_id, str(tag_id))
                    if isinstance(value, bytes):
                        try:
                            value = value.decode('utf-8', errors='replace')
                        except Exception:
                            value = repr(value)
                    exif_data[name] = str(value) if not isinstance(value, (int, float)) else value

                sw = str(exif_data.get('Software', '')).lower()
                if sw:
                    flags['has_software_tag'] = True
                    if any(k in sw for k in _EDITOR_KEYWORDS):
                        flags['software_suspicious'] = True
                        findings.append(f'EXIF Software 标签含编辑软件痕迹: {sw}')

                dto = exif_data.get('DateTimeOriginal', '')
                dt = exif_data.get('DateTime', '')
                if dto and dt and dto != dt:
                    flags['datetime_inconsistent'] = True
                    findings.append('EXIF 日期不一致 (DateTimeOriginal ≠ DateTime)，文件可能被修改后重新保存')
            else:
                flags['no_exif'] = True
        except Exception as e:
            logger.warning(f"Forensics EXIF: {e}")
            flags['no_exif'] = True

        # ── XMP (raw bytes scan) ──
        try:
            head = raw[:20000]
            if b'<x:xmpmeta' in head or b'xmlns:xmp' in head or b'xmp:CreatorTool' in head:
                flags['has_xmp'] = True
                lower = head.lower()
                for kw_bytes in [b'adobe', b'photoshop', b'gimp', b'corel', b'affinity']:
                    if kw_bytes in lower:
                        flags['xmp_creator_tool'] = kw_bytes.decode()
                        flags['software_suspicious'] = True
                        findings.append(f'XMP 元数据含 {kw_bytes.decode()} 创建工具痕迹')
                        break
        except Exception:
            pass

        # ── PNG text chunks ──
        if image.format == 'PNG':
            try:
                info = getattr(image, 'info', {}) or {}
                for k in ('Software', 'software', 'Creation Time', 'Source'):
                    v = str(info.get(k, '')).lower()
                    if v and any(kw in v for kw in _EDITOR_KEYWORDS):
                        findings.append(f'PNG chunk 含编辑信息: {info.get(k)}')
                        flags['software_suspicious'] = True
                        break
            except Exception:
                pass

        return {
            'exif': exif_data,
            'flags': flags,
            'findings': findings,
            'suspicious': flags['software_suspicious'],
        }

    # ── 2. Error Level Analysis ──────────────────────────────────────

    def _error_level_analysis(self, image: Image.Image) -> Dict[str, Any]:
        """ELA with spatial clustering check.

        Invoice text/stamps naturally produce scattered high-error blocks.
        Real tampering produces a *contiguous cluster* of anomalous blocks.
        We use 3.5σ threshold (vs old 2σ) and require spatial adjacency.
        """
        findings: List[str] = []
        flags: Dict[str, Any] = {'ela_performed': False, 'max_error': 0, 'mean_error': 0,
                                 'suspicious_regions': 0, 'clustered': False}

        try:
            rgb = image if image.mode == 'RGB' else image.convert('RGB')
            buf = io.BytesIO()
            rgb.save(buf, format='JPEG', quality=95)
            buf.seek(0)
            recomp = Image.open(buf)

            orig_arr = np.array(rgb, dtype=np.float64)
            rec_arr = np.array(recomp, dtype=np.float64)
            diff = np.abs(orig_arr - rec_arr)
            ela = np.mean(diff, axis=2)

            flags['ela_performed'] = True
            flags['mean_error'] = round(float(np.mean(ela)), 2)
            flags['max_error'] = round(float(np.max(ela)), 2)

            h, w = ela.shape
            if h >= 128 and w >= 128:
                bs = min(h, w) // 8
                grid_h = (h - bs) // bs + 1
                grid_w = (w - bs) // bs + 1
                means = np.empty((grid_h, grid_w), dtype=np.float64)
                for gy in range(grid_h):
                    for gx in range(grid_w):
                        y, x = gy * bs, gx * bs
                        means[gy, gx] = float(np.mean(ela[y:y + bs, x:x + bs]))

                gm = float(np.mean(means))
                gs = float(np.std(means))
                thresh = gm + 3.5 * gs  # much more conservative than 2σ

                # binary map of suspicious blocks
                susp_map = means > thresh
                n_susp = int(np.sum(susp_map))
                flags['suspicious_regions'] = n_susp
                pct = (n_susp / means.size) * 100

                # spatial clustering: count contiguous components (4-connected)
                if n_susp >= 3 and grid_h > 1 and grid_w > 1:
                    visited = np.zeros_like(susp_map, dtype=bool)
                    components = []
                    for gy in range(grid_h):
                        for gx in range(grid_w):
                            if susp_map[gy, gx] and not visited[gy, gx]:
                                # BFS to count component size
                                stack = [(gy, gx)]
                                visited[gy, gx] = True
                                size = 0
                                while stack:
                                    cy, cx = stack.pop()
                                    size += 1
                                    for ny, nx in [(cy-1,cx),(cy+1,cx),(cy,cx-1),(cy,cx+1)]:
                                        if 0 <= ny < grid_h and 0 <= nx < grid_w:
                                            if susp_map[ny, nx] and not visited[ny, nx]:
                                                visited[ny, nx] = True
                                                stack.append((ny, nx))
                                components.append(size)
                    max_cluster = max(components) if components else 0
                    flags['max_cluster_size'] = max_cluster
                    flags['component_count'] = len(components)

                    # True positive: a single large cluster (contiguous edit region)
                    # False positive: many small scattered blocks (text/stamps)
                    if max_cluster >= 4 and max_cluster >= n_susp * 0.4:
                        flags['clustered'] = True
                        findings.append(
                            f'ELA: 检测到 {n_susp} 个异常区块({pct:.0f}%)呈空间聚集 '
                            f'(最大连通分量={max_cluster})，可能存在像素级编辑'
                        )
                elif n_susp > 0:
                    # Too few blocks to cluster — probably noise
                    flags['clustered'] = False

        except Exception as e:
            logger.warning(f"Forensics ELA: {e}")
            flags['error'] = str(e)

        return {
            'flags': flags,
            'findings': findings,
            'suspicious': flags.get('clustered', False),
        }

    # ── 3. JPEG double compression ───────────────────────────────────

    def _detect_jpeg_double_compression(self, image: Image.Image, raw: bytes) -> Dict[str, Any]:
        findings: List[str] = []
        flags: Dict[str, Any] = {
            'is_jpeg': False, 'estimated_quality': None,
            'double_compressed': False, 'quality_mismatch': False,
        }

        try:
            if image.format != 'JPEG':
                return {'flags': flags, 'findings': [], 'suspicious': False}
            flags['is_jpeg'] = True

            if hasattr(image, 'quantization') and image.quantization:
                qt = image.quantization
                qtable = np.array(qt.get(0, qt.get(next(iter(qt.keys())) if qt else 0)))
                if qtable.size:
                    flags['estimated_quality'] = self._qtable_to_quality(qtable)

            test_img = image if image.mode == 'RGB' else image.convert('RGB')
            orig_sz = len(raw)
            sizes = {}
            for q in (70, 85, 95):
                b = io.BytesIO()
                test_img.save(b, format='JPEG', quality=q)
                sizes[q] = len(b.getvalue())
            flags.update({f'size_at_{k}': v for k, v in sizes.items()})
            flags['original_size'] = orig_sz

            if sizes.get(95, 0) < orig_sz * 0.8:
                flags['quality_mismatch'] = True
                findings.append('JPEG 重新保存后文件显著变小，原始来源可能是无损/高质量格式，存在格式转换嫌疑')

            sz_range = max(sizes.values()) - min(sizes.values())
            if orig_sz > 0 and sz_range < orig_sz * 0.05:
                flags['flat_size_curve'] = True
                findings.append('JPEG 压缩曲线异常平坦，可能经过重度编辑后重新保存')

        except Exception as e:
            logger.warning(f"Forensics JPEG ghost: {e}")
            flags['error'] = str(e)

        return {
            'flags': flags,
            'findings': findings,
            'suspicious': flags.get('double_compressed') or flags.get('quality_mismatch'),
        }

    @staticmethod
    def _qtable_to_quality(qtable: np.ndarray) -> Optional[int]:
        try:
            std50 = np.array([
                [16, 11, 10, 16, 24, 40, 51, 61],
                [12, 12, 14, 19, 26, 58, 60, 55],
                [14, 13, 16, 24, 40, 57, 69, 56],
                [14, 17, 22, 29, 51, 87, 80, 62],
                [18, 22, 37, 56, 68, 109, 103, 77],
                [24, 35, 55, 64, 81, 104, 113, 92],
                [49, 64, 78, 87, 103, 121, 120, 101],
                [72, 92, 95, 98, 112, 100, 103, 99],
            ], dtype=np.float64)
            if qtable.shape != std50.shape:
                return None
            ratio = float(np.mean(qtable) / np.mean(std50))
            if ratio <= 0:
                return 100
            if ratio < 1:
                return max(1, min(100, int(5000.0 / ratio)))
            return max(1, min(100, int(200 - ratio * 2)))
        except Exception:
            return None

    # ── 4. Noise consistency (pure numpy) ────────────────────────────

    def _analyze_noise_consistency(self, image: Image.Image) -> Dict[str, Any]:
        """Noise analysis on smooth regions only.

        Invoice images contain text on white background. Text regions have
        naturally different local variance than background, so comparing all
        blocks indiscriminately produces false positives.

        Fix: first classify blocks as smooth (background) vs textured (text/edges),
        then only check noise uniformity among smooth blocks. An edit region on
        the background would produce smooth blocks with anomalous noise.
        """
        findings: List[str] = []
        flags: Dict[str, Any] = {'noise_std': 0, 'noise_uniformity': 0,
                                 'smooth_block_count': 0, 'suspicious_variance': False}

        try:
            gray = np.array(image.convert('L'), dtype=np.float64)
            h, w = gray.shape
            if h < 128 or w < 128:
                return {'flags': flags, 'findings': [], 'suspicious': False}

            # High-pass noise extraction
            k = 5
            kernel = np.ones((k, k), dtype=np.float64) / (k * k)
            local_mean = _conv2d_valid(gray, kernel)
            pad = k // 2
            cropped = gray[pad:pad + local_mean.shape[0], pad:pad + local_mean.shape[1]]
            noise = cropped - local_mean
            nh, nw = noise.shape

            noise_std = float(np.std(noise))
            flags['noise_std'] = round(noise_std, 2)

            bs = max(32, min(h, w) // 10)
            if nh < bs * 2 or nw < bs * 2:
                return {'flags': flags, 'findings': [], 'suspicious': False}

            # Classify blocks: smooth (background) vs textured (text/edges)
            # Use local variance on the *original* image (not noise) for classification
            smooth_stds = []
            textured_stds = []
            for y in range(0, nh - bs + 1, bs):
                for x in range(0, nw - bs + 1, bs):
                    block_orig = cropped[y:y + bs, x:x + bs]
                    block_noise = noise[y:y + bs, x:x + bs]
                    local_var = float(np.var(block_orig))
                    noise_block_std = float(np.std(block_noise))

                    # Variance threshold: smooth regions have low pixel variance
                    # Text/edge regions have high variance because of content
                    if local_var < 200:  # empirically calibrated for document images
                        smooth_stds.append(noise_block_std)
                    else:
                        textured_stds.append(noise_block_std)

            flags['smooth_block_count'] = len(smooth_stds)

            if len(smooth_stds) >= 6:
                ms = float(np.mean(smooth_stds))
                ss = float(np.std(smooth_stds))
                flags['noise_uniformity'] = round(ss / ms, 3) if ms > 1e-6 else 0

                # Only flag when smooth-block noise is truly bimodal (CV > 1.0)
                # CV ~0.5 is normal for e-invoices; edited regions push smooth blocks apart
                if ss > ms * 1.0 and ms > 0.5:
                    flags['suspicious_variance'] = True
                    findings.append(
                        f'噪声一致性异常: {len(smooth_stds)} 个背景区块噪声CV={flags["noise_uniformity"]:.2f}，'
                        '可能存在编辑后抹平的拼接区域'
                    )
            elif len(smooth_stds) > 0:
                flags['noise_uniformity'] = 0
            else:
                # All blocks are textured — unusual but not a forensics signal
                flags['noise_uniformity'] = 0

        except Exception as e:
            logger.warning(f"Forensics noise: {e}")
            flags['error'] = str(e)

        return {
            'flags': flags,
            'findings': findings,
            'suspicious': flags.get('suspicious_variance'),
        }

    # ── Scoring ──────────────────────────────────────────────────────

    @staticmethod
    def _risk_score(meta: Dict, ela: Dict, jpeg: Dict, noise: Dict) -> int:
        score = 0
        if meta.get('flags', {}).get('software_suspicious'):
            score += 35
        elif meta.get('flags', {}).get('no_exif'):
            score += 10

        # ELA: only score if spatially clustered (not just scattered text noise)
        if ela.get('flags', {}).get('clustered'):
            cluster_size = ela['flags'].get('max_cluster_size', 0)
            if cluster_size >= 8:
                score += 30
            else:
                score += 18

        if jpeg.get('flags', {}).get('double_compressed'):
            score += 30
        if jpeg.get('flags', {}).get('quality_mismatch'):
            score += 25

        if noise.get('flags', {}).get('suspicious_variance'):
            score += 20

        return min(100, score)

    @staticmethod
    def _summary(score: int, level: str, details: List[str]) -> str:
        pre = {
            'high': '高风险: 该图像存在明显的编辑或造假痕迹，强烈建议人工复核原始文件。',
            'medium': '中风险: 该图像存在可疑特征，建议人工复核关键字段（金额、日期）。',
            'low': '低风险: 未检测到明显的图像篡改痕迹。',
        }.get(level, '无法评估。')
        if details:
            pre += f' 检测到 {len(details)} 条可疑特征。'
        return pre

    @staticmethod
    def _empty_result(msg: str) -> Dict[str, Any]:
        return {
            'risk_score': 0, 'risk_level': 'unknown',
            'metadata_result': {}, 'ela_result': {},
            'jpeg_double_compression_result': {}, 'noise_consistency_result': {},
            'summary': msg, 'details': [msg],
        }


# ── Pure-numpy 2D convolution (no scipy) ──────────────────────────────

def _conv2d_valid(arr: np.ndarray, kernel: np.ndarray) -> np.ndarray:
    kh, kw = kernel.shape
    h, w = arr.shape
    out_h, out_w = h - kh + 1, w - kw + 1
    out = np.empty((out_h, out_w), dtype=np.float64)
    for i in range(out_h):
        for j in range(out_w):
            out[i, j] = np.sum(arr[i:i + kh, j:j + kw] * kernel)
    return out


# ── Singleton ────────────────────────────────────────────────────────

_forensics: Optional[ImageForensicsService] = None


def get_forensics_service() -> ImageForensicsService:
    global _forensics
    if _forensics is None:
        _forensics = ImageForensicsService()
    return _forensics
