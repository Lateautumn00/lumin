// e2e 假 yt-dlp 引擎源码（csc.exe 编译为真实 PE，绕开 Node spawn 无法直跑 .bat 的限制）
// 作者：cuilanchao · 修改时间：2026-11-18
// 行为：
//   -J                 → 输出 probe JSON（标题/平台/时长/封面）
//   --newline（下载）  → 输出 PROGRESS 进度行 → 在 -P 目录创建 4096B 文件 → 输出最终路径
//   参数含 fail        → 非零退出 + stderr（触发 VD_DOWNLOAD_FAILED，验证报错态）
using System;
using System.IO;
using System.Text;

class FakeYtDlp
{
    static int Main(string[] args)
    {
        Console.OutputEncoding = Encoding.UTF8;
        string joined = string.Join(" ", args);

        if (joined.Contains("fail"))
        {
            Console.Error.WriteLine("e2e fake engine failure");
            return 2;
        }

        if (Array.IndexOf(args, "-J") >= 0)
        {
            Console.Out.Write(
                "{\"title\":\"e2e 假视频\",\"webpage_url_domain\":\"bilibili.com\",\"duration\":60.0,\"thumbnail\":\"https://e2e.example/1.jpg\"}"
            );
            return 0;
        }

        string outDir = ".";
        for (int i = 0; i < args.Length - 1; i++)
        {
            if (args[i] == "-P")
            {
                outDir = args[i + 1];
            }
        }
        Directory.CreateDirectory(outDir);
        Console.Out.WriteLine("PROGRESS|1024|4096|512|10");
        Console.Out.WriteLine("PROGRESS|4096|4096|512|3");
        string finalPath = Path.Combine(outDir, "e2e-fake-video.mp4");
        File.WriteAllBytes(finalPath, new byte[4096]);
        Console.Out.WriteLine(finalPath);
        return 0;
    }
}
