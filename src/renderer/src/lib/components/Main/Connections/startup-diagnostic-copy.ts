type Copy = [title: string, description: string]

export const startupDiagnosticCopy: Record<string, [Copy, Copy]> = {
  dependency: [
    ['Python 依赖缺失或损坏', '可定向补装下方依赖，然后重启并复查。不会清除聊天或模型。'],
    [
      'Missing or broken Python dependency',
      'Repair the package shown below, then restart and check the service. Chat data and models are preserved.'
    ]
  ],
  'dependency-unknown': [
    [
      '无法确认缺失的依赖',
      '打开该服务的日志，查看最后一条导入失败信息。不会根据日志里的任意包名自动安装。'
    ],
    [
      'Unrecognized dependency failure',
      'Open the service log and check the last import error. Packages are not installed from arbitrary names in logs.'
    ]
  ],
  python: [
    [
      '内置 Python 缺失或不完整',
      '没有旧 Python 文件时可自动补装。如果目录里仍有旧文件，请退出 AuraPro，通过桌面安装向导修复。'
    ],
    [
      'Bundled Python is missing or incomplete',
      'Repair can install Python if there are no existing Python files. If old files remain, quit AuraPro and use the desktop setup wizard.'
    ]
  ],
  installer: [
    ['Python 包管理器缺失', '可补装 uv 后重新检查服务。'],
    ['Missing Python package installer', 'Repair can install uv and check the service again.']
  ],
  package: [
    ['组件安装不完整', '可从官方来源补齐组件，并重新检查服务。'],
    [
      'Incomplete component installation',
      'Restore the component from its official source and check it again.'
    ]
  ],
  setup: [
    ['组件尚未配置完成', '打开桌面端该组件的设置，完成安装或重新准备已选模型，再启动服务。'],
    [
      'Component setup is incomplete',
      'Finish installation or prepare the selected model in the desktop settings before starting the service.'
    ]
  ],
  network: [
    [
      '下载或网络连接失败',
      '检查网络、代理和下载源。若显示 429，先等待限流解除，再重新启动或安装。'
    ],
    [
      'Download or network failure',
      'Check your connection, proxy, and download source. For HTTP 429, wait for the rate limit to clear before starting or installing again.'
    ]
  ],
  port: [
    [
      '服务端口被占用',
      '先确认占用端口的程序，再关闭它；也可在支持自定义端口的组件设置中改用空闲端口。AuraPro 不会结束其他程序。'
    ],
    [
      'Service port is in use',
      'Identify and close the application using the port, or select a free port in settings if the service supports it. AuraPro does not terminate other applications.'
    ]
  ],
  locked: [
    [
      '文件正在使用或无法替换',
      '从系统托盘完全退出 AuraPro，必要时重启系统，再运行诊断。不要强行删除正在使用的 Python 文件。'
    ],
    [
      'A file is in use or cannot be replaced',
      'Quit AuraPro from the system tray, restart the computer if needed, and run diagnostics again. Do not force-delete Python files in use.'
    ]
  ],
  'locked-repair': [
    [
      'Python 依赖文件无法替换',
      '可先停止本机 WebUI 与 Sherpa，再定向补装下方依赖。如果仍被占用，请完全退出 AuraPro 或重启后重试。'
    ],
    [
      'A Python dependency file could not be replaced',
      'Repair can stop local WebUI and Sherpa before reinstalling this package. If the file is still in use, quit AuraPro completely or restart the computer and retry.'
    ]
  ],
  permission: [
    [
      '无法访问安装或数据文件',
      '检查当前账号能否读写安装与数据目录，以及安全软件是否拦截。不要先删除目录或以管理员身份反复安装。'
    ],
    [
      'Cannot access installation or data files',
      'Check that your account can read and write the installation and data folders and that security software is not blocking them. Do not delete the folders or repeatedly install as administrator.'
    ]
  ],
  disk: [
    ['磁盘空间不足', '为 AuraPro 安装目录和系统临时目录所在磁盘释放空间，再重新启动或修复。'],
    [
      'Not enough disk space',
      'Free space on the drives that contain the AuraPro installation and system temporary directory, then retry.'
    ]
  ],
  database: [
    [
      'WebUI 数据库无法打开或迁移',
      '关闭其他使用此数据库的 WebUI 实例，确认数据目录可写，并先备份再处理。不会自动删除、重建或回滚数据库。'
    ],
    [
      'WebUI database could not open or migrate',
      'Close other WebUI instances using the database, verify the data directory is writable, and back it up before making changes. Repair will not delete, rebuild, or roll back the database.'
    ]
  ],
  config: [
    [
      '启动配置无效',
      '查看日志定位出错的文件或设置，在对应组件的设置中更正。不会自动恢复出厂设置。'
    ],
    [
      'Invalid startup configuration',
      'Check the log for the file or setting that failed, then correct it in the service settings. Repair does not reset the app.'
    ]
  ],
  certificate: [
    [
      '证书或 HTTPS 检查失败',
      '检查系统时间、代理证书或本机 HTTPS 设置。AuraPro 不会为了修复而关闭证书验证。'
    ],
    [
      'Certificate or HTTPS verification failed',
      'Check the system clock, proxy certificate, or local HTTPS settings. Repair does not turn off certificate verification.'
    ]
  ],
  memory: [
    ['内存不足', '关闭其他占用内存的程序；如果是推理服务，降低上下文或并发，或者选择较小的模型。'],
    [
      'Not enough memory',
      'Close other memory-intensive applications. For inference, reduce context or parallelism, or use a smaller model.'
    ]
  ],
  platform: [
    [
      '系统或架构与依赖不兼容',
      '检查系统版本、安装包架构以及对应平台是否有预编译依赖；不会自动从源码编译。'
    ],
    [
      'Incompatible system or architecture',
      'Check the OS version, installer architecture, and availability of prebuilt dependencies. Repair does not build packages from source.'
    ]
  ],
  native: [
    [
      '系统运行库缺失',
      '根据日志中的 DLL 名称，通过操作系统或官方安装包补齐运行库后重试。不要从第三方网站下载单独的 DLL。'
    ],
    [
      'Missing system runtime',
      'Use the DLL name in the log to identify the missing OS or vendor runtime. Do not download individual DLL files from third-party sites.'
    ]
  ],
  security: [
    [
      '服务被系统安全策略拦截',
      '确认安装包来源可信，并检查系统安全事件或联系管理员。诊断不会关闭系统防护。'
    ],
    [
      'Blocked by system security policy',
      'Verify the installer source and review system security events, or contact your administrator. Diagnostics do not disable security protections.'
    ]
  ],
  model: [
    [
      '模型缺失或未准备好',
      '在对应组件的模型设置中重新下载或准备已选择的模型。不会擅自更换或删除模型。'
    ],
    [
      'Model missing or not prepared',
      'Download or prepare the selected model in the component settings. Diagnostics do not replace or delete your models.'
    ]
  ],
  timeout: [
    ['服务长时间未就绪', '可重启这一服务并再次检查。若仍失败，请查看该服务的最后几行日志。'],
    [
      'Service did not become ready',
      'Restart this service and verify it again. If the issue persists, check the last lines of its log.'
    ]
  ],
  unknown: [
    ['服务未能启动', '暂未确认原因，可先重启并重新检测。若仍失败，请提供下方错误详情。'],
    [
      'Service did not start',
      'The cause is not confirmed. Restart and check again. If it still fails, share the error details below.'
    ]
  ]
}
